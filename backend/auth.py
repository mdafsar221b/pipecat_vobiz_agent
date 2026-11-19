import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

BASE_DIR = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env", override=True)
except ImportError:
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip().strip("'\"")

try:
    from loguru import logger
except ImportError:
    import logging
    logger = logging.getLogger("auth")
    logging.basicConfig(level=logging.INFO)

try:
    from fastapi import Depends, HTTPException, Request, status
    from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
    security = HTTPBearer(auto_error=False)
except ImportError:
    HTTPBearer = HTTPAuthorizationCredentials = None
    security = None
    Request = status = HTTPException = None
    def Depends(dep=None):
        return None

JWT_SECRET = (os.getenv("JWT_SECRET") or os.getenv("SECRET_KEY") or "swargaseema_voice_jwt_secret_key_2026_production").strip().strip("'\"")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("ACCESS_TOKEN_EXPIRE_HOURS", "72"))
ADMIN_EMAIL = (os.getenv("SUPER_ADMIN_EMAIL") or os.getenv("ADMIN_EMAIL") or "singhnitesh56789@gmail.com").strip().strip("'\"").lower()
ADMIN_PASSWORD = (os.getenv("SUPER_ADMIN_PASSWORD") or os.getenv("ADMIN_PASSWORD") or "Admin@123").strip().strip("'\"")

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")

# ==========================================
# Secure Password Hashing (PBKDF2-HMAC-SHA256)
# ==========================================
def hash_password(password: str) -> str:
    """Hash password with PBKDF2-HMAC-SHA256 using 100,000 iterations and 16-byte random salt."""
    salt = secrets.token_bytes(16)
    iterations = 100000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{salt.hex()}${iterations}${digest.hex()}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against the stored salt$iterations$digest hash."""
    if not hashed_password or "$" not in hashed_password:
        return False
    try:
        parts = hashed_password.split("$")
        if len(parts) != 3:
            return False
        salt = bytes.fromhex(parts[0])
        iterations = int(parts[1])
        expected_digest = bytes.fromhex(parts[2])
        actual_digest = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(expected_digest, actual_digest)
    except Exception as exc:
        logger.error(f"Password verification error: {exc}")
        return False

# ==========================================
# Native JWT Implementation (HS256)
# ==========================================
def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")

def _b64url_decode(data: str) -> bytes:
    padding = "=" * (4 - (len(data) % 4)) if len(data) % 4 else ""
    return base64.urlsafe_b64decode((data + padding).encode("utf-8"))

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create a signed JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode["exp"] = int(expire.timestamp())
    to_encode["iat"] = int(datetime.now(timezone.utc).timestamp())

    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    payload_bytes = json.dumps(to_encode, separators=(",", ":")).encode("utf-8")

    unsigned_token = f"{_b64url_encode(header_bytes)}.{_b64url_encode(payload_bytes)}"
    signature = hmac.new(JWT_SECRET.encode("utf-8"), unsigned_token.encode("utf-8"), hashlib.sha256).digest()
    return f"{unsigned_token}.{_b64url_encode(signature)}"

def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify and decode a signed JWT access token."""
    try:
        parts = token.strip().split(".")
        if len(parts) != 3:
            return None
        unsigned_token = f"{parts[0]}.{parts[1]}"
        expected_sig = hmac.new(JWT_SECRET.encode("utf-8"), unsigned_token.encode("utf-8"), hashlib.sha256).digest()
        actual_sig = _b64url_decode(parts[2])
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None

        payload_bytes = _b64url_decode(parts[1])
        payload = json.loads(payload_bytes.decode("utf-8"))
        exp = payload.get("exp")
        if exp and int(time.time()) > exp:
            return None  # Expired
        return payload
    except Exception:
        return None

def generate_random_token() -> str:
    """Generate cryptographically secure URL-safe token for email verification and password reset."""
    return secrets.token_urlsafe(36)

def reload_env() -> None:
    """Reload environment variables from .env dynamically so user additions take effect immediately."""
    try:
        from dotenv import load_dotenv
        load_dotenv(BASE_DIR / ".env", override=True)
    except Exception:
        pass
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        os.environ[k.strip()] = v.strip().strip("'\"")
        except Exception:
            pass

# ==========================================
# Pure .env User Management (Zero DB Touches)
# ==========================================
def get_env_users() -> list:
    """Load all configured active users from .env (Super Admin + 10 Employee slots).
    Zero database calls. Production MongoDB users collection is completely untouched.
    """
    reload_env()
    users = []

    # Super Admin
    super_email = (os.getenv("SUPER_ADMIN_EMAIL") or os.getenv("ADMIN_EMAIL") or "").strip().strip("'\"").lower()
    super_pass = (os.getenv("SUPER_ADMIN_PASSWORD") or os.getenv("ADMIN_PASSWORD") or "").strip().strip("'\"")
    super_name = (os.getenv("SUPER_ADMIN_NAME") or "Super Admin").strip().strip("'\"")
    if super_email and super_pass:
        users.append({
            "id": "admin_root",
            "name": super_name,
            "email": super_email,
            "password": super_pass,
            "role": "admin",
            "is_active": True,
            "phone": os.getenv("FROM_NUMBER", ""),
            "slot": "SUPER_ADMIN",
        })

    # Users 1 to 10
    for i in range(1, 11):
        email = (os.getenv(f"USER_{i}_EMAIL") or "").strip().strip("'\"").lower()
        password = (os.getenv(f"USER_{i}_PASSWORD") or "").strip().strip("'\"")
        name = (os.getenv(f"USER_{i}_NAME") or f"Employee {i}").strip().strip("'\"")
        role = (os.getenv(f"USER_{i}_ROLE") or "employee").strip().strip("'\"").lower()
        phone = (os.getenv(f"USER_{i}_PHONE") or "").strip().strip("'\"")

        # If email and password are provided, mark as active user
        if email and password:
            users.append({
                "id": f"env_user_{i}",
                "name": name,
                "email": email,
                "password": password,
                "role": role if role in ("admin", "employee") else "employee",
                "is_active": True,
                "phone": phone,
                "slot": f"USER_{i}",
            })
    return users

def get_all_user_slots() -> list:
    """Return all 10 employee slots + super admin for the UI directory, showing active vs unassigned slots."""
    reload_env()
    slots = []
    # Super Admin
    super_email = (os.getenv("SUPER_ADMIN_EMAIL") or os.getenv("ADMIN_EMAIL") or "").strip().strip("'\"").lower()
    super_name = (os.getenv("SUPER_ADMIN_NAME") or "Super Admin").strip().strip("'\"")
    slots.append({
        "id": "admin_root",
        "name": super_name,
        "email": super_email if super_email else "--",
        "role": "admin",
        "is_active": bool(super_email),
        "phone": os.getenv("FROM_NUMBER", ""),
        "slot": "SUPER_ADMIN",
        "status": "Active (Configured in .env)" if super_email else "Unassigned / Empty slot",
    })

    for i in range(1, 11):
        email = (os.getenv(f"USER_{i}_EMAIL") or "").strip().strip("'\"").lower()
        password = (os.getenv(f"USER_{i}_PASSWORD") or "").strip().strip("'\"")
        name = (os.getenv(f"USER_{i}_NAME") or f"Employee {i}").strip().strip("'\"")
        role = (os.getenv(f"USER_{i}_ROLE") or "employee").strip().strip("'\"").lower()
        phone = (os.getenv(f"USER_{i}_PHONE") or "").strip().strip("'\"")

        is_configured = bool(email and password)
        slots.append({
            "id": f"env_user_{i}",
            "name": name if is_configured else f"Slot {i} (Available)",
            "email": email if email else "--",
            "role": role if role in ("admin", "employee") else "employee",
            "is_active": is_configured,
            "phone": phone,
            "slot": f"USER_{i}",
            "status": "Active (Configured in .env)" if is_configured else "Unassigned / Empty slot in .env",
        })
    return slots

def authenticate_user(email: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticate email and password strictly against .env users."""
    if not email or not password:
        return None
    email_clean = email.strip().lower()
    for u in get_env_users():
        if u["email"] == email_clean:
            if password == u["password"] or verify_password(password, u["password"]):
                return {
                    "id": u["id"],
                    "name": u["name"],
                    "email": u["email"],
                    "role": u["role"],
                    "phone": u.get("phone", ""),
                    "is_active": u.get("is_active", True),
                    "slot": u.get("slot", ""),
                }
    return None

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    if not email:
        return None
    email_clean = email.strip().lower()
    for u in get_env_users():
        if u["email"] == email_clean:
            return {k: v for k, v in u.items() if k != "password"}
    return None

def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    for u in get_env_users():
        if u["id"] == user_id:
            return {k: v for k, v in u.items() if k != "password"}
    return None

def init_admin_user() -> None:
    """Log configured .env users on startup without touching MongoDB."""
    users = get_env_users()
    logger.info(f"👥 Loaded {len(users)} user(s) from .env (MongoDB users collection completely untouched)")

def get_users_collection():
    """Disabled: zero database access to production users collection."""
    return None

# ==========================================
# FastAPI Auth Dependencies
# ==========================================
async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Dict[str, Any]:
    """Dependency: retrieve currently authenticated user from Bearer header or cookie."""
    token = None
    if creds and creds.credentials:
        token = creds.credentials
    if not token:
        token = request.cookies.get("auth_token") or request.query_params.get("token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication session",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("user_id") or payload.get("id")
    email = payload.get("email")
    user = get_user_by_id(user_id) if user_id else get_user_by_email(email)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deactivated. Please contact administrator.",
        )

    return user

async def require_admin(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Dependency: require administrator role."""
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required for this action",
        )
    return current_user

async def get_optional_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[Dict[str, Any]]:
    """Optional authentication dependency: returns user if token present and valid, else None."""
    try:
        return await get_current_user(request, creds)
    except HTTPException:
        return None
