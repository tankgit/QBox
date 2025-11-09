from __future__ import annotations

import secrets
import string


def generate_id(prefix: str, length: int = 8) -> str:
    alphabet = string.ascii_lowercase + string.digits
    suffix = "".join(secrets.choice(alphabet) for _ in range(length))
    return f"{prefix}{suffix}"

