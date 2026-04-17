"""
IARIS credential management.

Credentials are loaded once from ~/.iaris and cached in memory.
The frontend never receives secret values.
"""

from __future__ import annotations

import json
import logging
import os
import stat
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger("iaris.credentials")

DEFAULT_CREDENTIAL_DIR = Path.home() / ".iaris"
GEMINI_KEY_FILE = "gemini.key"
GOOGLE_JSON_FILE = "google.json"


@dataclass
class CredentialStore:
    """In-memory credential payload."""

    gemini_api_key: str = ""
    google_service_account: Optional[dict] = None
    loaded_at: float = field(default_factory=time.time)

    @property
    def has_gemini_key(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def has_google_service_account(self) -> bool:
        return bool(self.google_service_account)


class CredentialManager:
    """Loads backend-only credentials and keeps them in memory."""

    def __init__(self, credential_dir: Optional[Path] = None):
        self.credential_dir = credential_dir or DEFAULT_CREDENTIAL_DIR
        self._store = CredentialStore()

    def load(self) -> CredentialStore:
        """Load credentials from disk into memory."""
        self.credential_dir.mkdir(parents=True, exist_ok=True)

        gemini_path = self.credential_dir / GEMINI_KEY_FILE
        google_path = self.credential_dir / GOOGLE_JSON_FILE

        gemini_key = ""
        if gemini_path.exists():
            try:
                gemini_key = gemini_path.read_text(encoding="utf-8-sig").lstrip("\ufeff").strip()
            except Exception as exc:
                logger.warning("Failed to read Gemini key: %s", exc)

        google_service_account = None
        if google_path.exists():
            try:
                data = json.loads(google_path.read_text(encoding="utf-8-sig"))
                if isinstance(data, dict):
                    google_service_account = data
            except Exception as exc:
                logger.warning("Failed to read Google service account JSON: %s", exc)

        self._store = CredentialStore(
            gemini_api_key=gemini_key,
            google_service_account=google_service_account,
            loaded_at=time.time(),
        )

        # Best-effort file permission tightening on POSIX platforms.
        if os.name != "nt":
            self._try_secure_permissions(gemini_path)
            self._try_secure_permissions(google_path)

        logger.info(
            "Credential manager initialized (gemini=%s, google_json=%s)",
            "loaded" if self._store.has_gemini_key else "missing",
            "loaded" if self._store.has_google_service_account else "missing",
        )
        return self._store

    def get_store(self) -> CredentialStore:
        """Get cached credentials."""
        return self._store

    def status(self) -> dict:
        """Return safe credential status without exposing secret content."""
        return {
            "credential_dir": str(self.credential_dir),
            "gemini_key_loaded": self._store.has_gemini_key,
            "google_service_account_loaded": self._store.has_google_service_account,
            "loaded_at": self._store.loaded_at,
        }

    @staticmethod
    def _try_secure_permissions(path: Path) -> None:
        if not path.exists():
            return
        try:
            current_mode = stat.S_IMODE(path.stat().st_mode)
            if current_mode != 0o600:
                path.chmod(0o600)
        except Exception:
            # Permission hardening is best effort and should never crash startup.
            return
