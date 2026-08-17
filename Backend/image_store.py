"""
MongoDB / GridFS storage layer for BHU-DRISHTI site imagery.

All T1 / T2 / label PNGs live in a GridFS bucket ("images") instead of the
local data/ folder. Each stored file carries metadata {site_id, epoch} so it
can be located deterministically regardless of filename revisions.

Connection is configured through environment variables (see .env.example):
  MONGODB_URI  - Atlas connection string (mongodb+srv://...)
  MONGODB_DB   - database name (default: bhu_drishti)
"""

import os
import threading
from collections import OrderedDict
from functools import lru_cache

import gridfs
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

EPOCHS = ("T1", "T2", "label")

# In-memory LRU cache for image bytes. Atlas downloads run at ~300 KB/s here
# (~7s per 2MB image), so every image is fetched from MongoDB at most once per
# process; repeat views and the analyze -> image-endpoint handoff hit RAM.
_CACHE_MAX_ENTRIES = 64  # ~130MB worst case; current dataset is ~40MB
_cache: "OrderedDict[tuple[str, str], bytes]" = OrderedDict()
_cache_lock = threading.Lock()


def _fix_srv_resolver(uri: str) -> None:
    """
    mongodb+srv:// URIs require a DNS SRV lookup, which some routers/ISPs
    silently drop. If the system resolver can't resolve the cluster's SRV
    record, switch dnspython's default resolver to public DNS servers.
    """
    import dns.resolver

    host = uri.split("@")[-1].split("/")[0].split(",")[0]
    try:
        dns.resolver.resolve(f"_mongodb._tcp.{host}", "SRV", lifetime=5)
    except Exception:
        fallback = dns.resolver.Resolver(configure=False)
        fallback.nameservers = ["8.8.8.8", "1.1.1.1"]
        dns.resolver.default_resolver = fallback


@lru_cache
def _client() -> MongoClient:
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise RuntimeError(
            "MONGODB_URI is not set. Copy .env.example to .env and fill in "
            "your MongoDB Atlas connection string."
        )
    if uri.startswith("mongodb+srv://"):
        _fix_srv_resolver(uri)
    return MongoClient(uri)


def _db():
    return _client()[os.environ.get("MONGODB_DB", "bhu_drishti")]


def _bucket() -> gridfs.GridFSBucket:
    return gridfs.GridFSBucket(_db(), bucket_name="images")


def _files():
    return _db()["images.files"]


def get_image_bytes(site_id: str, epoch: str):
    """Return the PNG bytes for a site/epoch, or None if not stored.

    Results are cached in process memory: a download from Atlas happens at
    most once per site/epoch per process.
    """
    key = (site_id, epoch)
    with _cache_lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return cached

    file_doc = _files().find_one(
        {"metadata.site_id": site_id, "metadata.epoch": epoch}
    )
    if file_doc is None:
        return None
    data = _bucket().open_download_stream(file_doc["_id"]).read()

    with _cache_lock:
        _cache[key] = data
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)
    return data


def warm_cache() -> None:
    """Pre-download every stored image into the in-memory cache.

    Intended to run in a background thread at server startup so the first
    user request doesn't pay the Atlas download cost. Best-effort: any
    failure leaves the cache to fill lazily on demand.
    """
    try:
        sites = list_complete_sites()
    except Exception:
        return
    for site_id in sites:
        for epoch in EPOCHS:
            try:
                get_image_bytes(site_id, epoch)
            except Exception:
                pass


def list_complete_sites():
    """Site IDs that have both T1 and T2 imagery stored in MongoDB."""
    t1 = set(_files().distinct("metadata.site_id", {"metadata.epoch": "T1"}))
    t2 = set(_files().distinct("metadata.site_id", {"metadata.epoch": "T2"}))
    return sorted(t1 & t2)


def upload_image(site_id: str, epoch: str, png_bytes: bytes) -> None:
    """Store (or replace) a PNG for a site/epoch."""
    existing = _files().find_one(
        {"metadata.site_id": site_id, "metadata.epoch": epoch}
    )
    if existing is not None:
        _bucket().delete(existing["_id"])
    _bucket().upload_from_stream(
        f"{site_id}_{epoch}.png",
        png_bytes,
        metadata={"site_id": site_id, "epoch": epoch},
    )
    with _cache_lock:
        _cache[(site_id, epoch)] = png_bytes
        _cache.move_to_end((site_id, epoch))
