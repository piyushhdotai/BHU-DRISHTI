"""
Bulk migration: upload T1/T2/label PNGs from a local folder OR a .zip file
into MongoDB GridFS. Zip files are read directly, no extraction needed.

Usage (from the Backend folder, venv active, .env configured):
    python migrate_images_to_mongo.py                            # uses ./data
    python migrate_images_to_mongo.py D:/path/to/dataset.zip
    python migrate_images_to_mongo.py D:/path/to/dataset.zip --max-mb 350
    python migrate_images_to_mongo.py D:/path/to/folder --max-mb 350

A PNG is assigned an epoch when one of its parent folders is named
T1/A/before, T2/B/after, or label/mask/gt (case-insensitive). The site ID
is the filename without extension.

Files upload site by site (T1+T2+label together) in natural sorted order
(train_2 before train_10). --max-mb stops before the site that would
exceed the limit, so a partial run never leaves a half-uploaded site.
Re-running is safe: an existing file for the same site/epoch is replaced.
"""

import os
import re
import sys
import zipfile

from image_store import upload_image

EPOCH_ALIASES = {
    "t1": "T1", "a": "T1", "before": "T1",
    "t2": "T2", "b": "T2", "after": "T2",
    "label": "label", "mask": "label", "gt": "label",
}

PROGRESS_EVERY = 25  # sites


def _epoch_from_path(path: str):
    """Epoch derived from the PNG's parent folder names, or None."""
    folders = path.replace("\\", "/").split("/")[:-1]
    for part in folders:
        epoch = EPOCH_ALIASES.get(part.lower())
        if epoch:
            return epoch
    return None


def _natural_key(site_id: str):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", site_id)]


class Catalog:
    """site_id -> {epoch: (size_in_bytes, locator)} plus skipped/duplicates."""

    def __init__(self):
        self.sites = {}
        self.skipped = 0
        self.duplicates = 0

    def add(self, path: str, size: int, locator):
        epoch = _epoch_from_path(path)
        if epoch is None:
            self.skipped += 1
            return
        site_id = os.path.splitext(os.path.basename(path))[0]
        epochs = self.sites.setdefault(site_id, {})
        if epoch in epochs:
            self.duplicates += 1
        epochs[epoch] = (size, locator)


def catalog_zip(zip_path: str) -> Catalog:
    cat = Catalog()
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            if info.is_dir() or not info.filename.lower().endswith(".png"):
                continue
            cat.add(info.filename, info.file_size, info.filename)
    return cat


def catalog_folder(root: str) -> Catalog:
    cat = Catalog()
    for dirpath, _, filenames in os.walk(root):
        for filename in sorted(filenames):
            if filename.lower().endswith(".png"):
                path = os.path.join(dirpath, filename)
                cat.add(path, os.path.getsize(path), path)
    return cat


def main():
    args = sys.argv[1:]
    max_mb = None
    if "--max-mb" in args:
        i = args.index("--max-mb")
        try:
            max_mb = float(args[i + 1])
        except (IndexError, ValueError):
            print("Usage: --max-mb <number, e.g. 350>")
            sys.exit(1)
        del args[i:i + 2]

    source = args[0] if args else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data"
    )

    if zipfile.is_zipfile(source):
        print(f"Cataloging zip: {source}")
        cat = catalog_zip(source)
        reader = zipfile.ZipFile(source).read
    elif os.path.isdir(source):
        print(f"Cataloging folder: {source}")
        cat = catalog_folder(source)
        reader = lambda path: open(path, "rb").read()
    else:
        print(f"Not a folder or zip file: {source}")
        sys.exit(1)

    limit = max_mb * 1024 * 1024 if max_mb is not None else None
    sites_done = files_done = bytes_done = 0
    stopped_early = False

    for site_id in sorted(cat.sites, key=_natural_key):
        epochs = cat.sites[site_id]
        site_bytes = sum(size for size, _ in epochs.values())
        if limit is not None and bytes_done + site_bytes > limit:
            stopped_early = True
            break
        for epoch, (size, locator) in sorted(epochs.items()):
            upload_image(site_id, epoch, reader(locator))
            files_done += 1
        bytes_done += site_bytes
        sites_done += 1
        if sites_done % PROGRESS_EVERY == 0:
            print(f"  progress: {sites_done} sites, "
                  f"{bytes_done / 1024 / 1024:.0f} MB uploaded")

    print(f"\nDone. {sites_done} sites ({files_done} files, "
          f"{bytes_done / 1024 / 1024:.1f} MB) uploaded.")
    if stopped_early:
        remaining = len(cat.sites) - sites_done
        print(f"Stopped at the --max-mb {max_mb:g} cap; "
              f"~{remaining} cataloged sites were not uploaded.")
    if cat.skipped:
        print(f"{cat.skipped} PNGs skipped (no T1/T2/label folder in path).")
    if cat.duplicates:
        print(f"WARNING: {cat.duplicates} duplicate site/epoch names found; "
              f"the last one in each case was used.")


if __name__ == "__main__":
    main()
