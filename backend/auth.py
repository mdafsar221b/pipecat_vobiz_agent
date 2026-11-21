import hashlib
import hmac
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger
import jwt

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env", override=True)

# Secret key for JWT signing and verification
JWT_SECRET = (
    os.getenv("JWT_SECRET")
    or os.getenv("JWT_SECRET_KEY")
    or "swargaseema_voice_jwt_secret_key_default_production_secure_2026"
)
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

# Bearer security scheme for Swagger / OpenAPI
security = HTTPBearer(auto_error=False)

def hash_password(password: str) -> str:
    """Generate secure NIST-standard PBKDF2-SHA256 hash for .env storage."""
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 600000)
    return f"pbkdf2:sha256:600000${salt}${dk.hex()}"

def verify_password(plain_password: str, stored_password_or_hash: str) -> bool:
    """Verify password against either PBKDF2-SHA256 hash or plaintext stored in .env."""
    if not plain_password or not stored_password_or_hash:
        return False

    stored = stored_password_or_hash.strip()
    if stored.startswith("pbkdf2:sha256:"):
        try:
            parts = stored.split("$")
            header = parts[0]
            iterations = int(header.split(":")[-1])
            salt = parts[1]
            stored_hash = parts[2]
            dk = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt.encode("utf-8"), iterations)
            return hmac.compare_digest(dk.hex(), stored_hash)
        except Exception as exc:
            logger.error(f"Error validating password hash: {exc}")
            return False

    # Plaintext comparison using constant-time comparison to prevent timing attacks
    return hmac.compare_digest(plain_password.strip(), stored)

def load_env_users() -> Dict[str, Dict[str, Any]]:
    """
    Parse configured users from .env file.
    Supports:
    1. SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD / SUPER_ADMIN_NAME
    2. ADMIN_EMAIL / ADMIN_PASSWORD
    3. USER_1_EMAIL ... USER_20_EMAIL with corresponding PASSWORD, NAME, ROLE
    4. APP_USERS="email:pass,email:pass"
    """
    # Reload .env to ensure fresh credentials if edited
    load_dotenv(BASE_DIR / ".env", override=True)
    users: Dict[str, Dict[str, Any]] = {}

    # 1. Super Admin
    super_email = os.getenv("SUPER_ADMIN_EMAIL", "").strip().lower()
    super_pass = os.getenv("SUPER_ADMIN_PASSWORD", "").strip()
    super_name = os.getenv("SUPER_ADMIN_NAME", "Super Admin").strip()
    if super_email and super_pass:
        users[super_email] = {
            "email": super_email,
            "password": super_pass,
            "name": super_name,
            "role": "superadmin",
        }

    # 2. Admin
    admin_email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    admin_pass = os.getenv("ADMIN_PASSWORD", "").strip()
    if admin_email and admin_pass and admin_email not in users:
        users[admin_email] = {
            "email": admin_email,
            "password": admin_pass,
            "name": os.getenv("ADMIN_NAME", "Admin").strip(),
            "role": "admin",
        }

    # 3. USER_1 through USER_20
    for idx in range(1, 21):
        u_email = os.getenv(f"USER_{idx}_EMAIL", "").strip().lower()
        u_pass = os.getenv(f"USER_{idx}_PASSWORD", "").strip()
        if u_email and u_pass:
            u_name = os.getenv(f"USER_{idx}_NAME", f"Agent {idx}").strip()
            u_role = os.getenv(f"USER_{idx}_ROLE", "agent").strip().lower()
            users[u_email] = {
                "email": u_email,
                "password": u_pass,
                "name": u_name,
                "role": u_role,
            }

    # 4. APP_USERS / USERS comma-separated fallback (e.g. "email:pass,email:pass")
    app_users_str = os.getenv("APP_USERS") or os.getenv("USERS") or ""
    if app_users_str.strip():
        for item in app_users_str.split(","):
            if ":" in item:
                parts = item.strip().split(":", 1)
                e = parts[0].strip().lower()
                p = parts[1].strip()
                if e and p and e not in users:
                    users[e] = {
                        "email": e,
                        "password": p,
                        "name": e.split("@")[0].capitalize(),
                        "role": "agent",
                    }

    return users

def create_access_token(user_data: Dict[str, Any]) -> str:
    """Generate signed JWT access token."""
    now = int(time.time())
    expire = now + (JWT_EXPIRE_HOURS * 3600)
    payload = {
        "sub": user_data["email"],
        "name": user_data.get("name", user_data["email"]),
        "role": user_data.get("role", "agent"),
        "iat": now,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and validate JWT access token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired. Please log in again.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )

def get_token_from_request(request: Request) -> Optional[str]:
    """Extract token from Authorization header or query parameter."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header.split(" ", 1)[1].strip()
    # Check query param (useful for WebSocket connections)
    token_param = request.query_params.get("token")
    if token_param:
        return token_param.strip()
    return None

def get_current_user(request: Request) -> Dict[str, Any]:
    """FastAPI dependency requiring valid JWT authentication."""
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(token)
    email = payload.get("sub", "").lower()
    users = load_env_users()
    if email not in users:
        # User was removed from .env or token forged
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists in authorized user list.",
        )
    user_info = users[email]
    return {
        "email": user_info["email"],
        "name": user_info["name"],
        "role": user_info["role"],
    }

def get_optional_user(request: Request) -> Optional[Dict[str, Any]]:
    """FastAPI dependency for endpoints that optionally authenticate."""
    try:
        return get_current_user(request)
    except HTTPException:
        return None

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 2 and sys.argv[1] == "hash":
        pw = sys.argv[2]
        print("\nGenerated PBKDF2 Password Hash (safe for .env):")
        print(hash_password(pw))
        print()
    else:
        loaded = load_env_users()
        print(f"Loaded {len(loaded)} user(s) from .env:")
        for em, u in loaded.items():
            print(f" - {em} ({u['name']}, role: {u['role']})")
