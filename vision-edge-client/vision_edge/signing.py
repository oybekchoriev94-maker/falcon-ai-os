"""HMAC-SHA256 imzolash — backend/services/edge-crypto.js va
backend/edge-auth.js bilan AYNAN bir xil algoritm bo'lishi shart:

    canonical = "\n".join([METHOD, PATH, str(timestamp), nonce, body_sha256_hex])
    signature = HMAC-SHA256(signing_key, canonical)

Bu faylni backend'dagi ikkitasidan mustaqil o'zgartirmang — mos
kelmasa server barcha so'rovlarni 401 bilan rad etadi.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from dataclasses import dataclass


@dataclass
class SignedRequest:
    headers: dict
    body: bytes


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def new_nonce() -> str:
    # Server NONCE_PATTERN: 32-64 hex belgi. 16 bayt -> 32 hex belgi.
    return os.urandom(16).hex()


def sign_request(
    *,
    signing_key: str,
    method: str,
    path: str,
    body: bytes,
    tenant_id: str,
    clinic_id: str,
    node_id: str,
    key_id: str,
) -> SignedRequest:
    timestamp = int(time.time())
    nonce = new_nonce()
    body_hash = sha256_hex(body)
    canonical = "\n".join([method.upper(), path, str(timestamp), nonce, body_hash])
    signature = hmac.new(
        bytes.fromhex(signing_key), canonical.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    headers = {
        "X-Falcon-Tenant": tenant_id,
        "X-Falcon-Clinic": clinic_id,
        "X-Falcon-Node": node_id,
        "X-Falcon-Key-ID": key_id,
        "X-Falcon-Timestamp": str(timestamp),
        "X-Falcon-Nonce": nonce,
        "X-Content-SHA256": body_hash,
        "X-Falcon-Signature": f"v1={signature}",
        "Content-Type": "application/json",
    }
    return SignedRequest(headers=headers, body=body)
