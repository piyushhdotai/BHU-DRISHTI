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
from functools import lru_cache

import gridfs
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

EPOCHS = ("T1", "T2", "label")


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
    """Return the PNG bytes for a site/epoch, or None if not stored."""
    file_doc = _files().find_one(
        {"metadata.site_id": site_id, "metadata.epoch": epoch}
    )
    if file_doc is None:
        return None
    return _bucket().open_download_stream(file_doc["_id"]).read()


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
