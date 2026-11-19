import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

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
    logger = logging.getLogger("email_service")
    logging.basicConfig(level=logging.INFO)

def get_smtp_config():
    raw_host = (os.getenv("SMTP_HOST") or os.getenv("IMAP_HOST") or "").strip().strip("'\"")
    raw_port = os.getenv("SMTP_PORT") or os.getenv("IMAP_PORT") or "587"
    raw_user = (os.getenv("SMTP_USER") or os.getenv("IMAP_USER") or "").strip().strip("'\"")
    raw_pass = (os.getenv("SMTP_PASSWORD") or os.getenv("IMAP_PASS") or "").strip().strip("'\"")
    raw_from = (os.getenv("SMTP_FROM_EMAIL") or os.getenv("IMAP_EMAIL") or raw_user or "no-reply@swargaseema.com").strip().strip("'\"")

    # If host is an email address (e.g. user entered IMAP_HOST='nyota.invite@gmail.com') or contains gmail, route to smtp.gmail.com
    host = raw_host
    if not host or "@" in host or "gmail" in host.lower() or "gmail" in raw_user.lower():
        host = "smtp.gmail.com"

    try:
        port = int(str(raw_port).strip().strip("'\""))
    except (ValueError, TypeError):
        port = 587

    return {
        "host": host,
        "port": port,
        "user": raw_user,
        "password": raw_pass,
        "from_email": raw_from,
        "use_tls": os.getenv("SMTP_USE_TLS", "true").lower() == "true",
        "use_ssl": os.getenv("SMTP_USE_SSL", "false").lower() == "true",
    }

def send_email(to_email: str, subject: str, html_content: str, text_content: Optional[str] = None) -> bool:
    """Send an HTML email via SMTP. Falls back gracefully with console logging if SMTP is not configured."""
    cfg = get_smtp_config()
    
    # If SMTP is not configured, log clearly and return False (callers will provide fallback link)
    if not cfg["host"] or not cfg["user"]:
        logger.warning(
            f"⚠️ SMTP not configured (SMTP_HOST/SMTP_USER empty). Email to {to_email} not sent via network."
        )
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        
        # Format From header correctly (if already formatted like 'Name <email>', keep as is)
        from_header = cfg["from_email"]
        if "<" not in from_header:
            from_header = f"Swargaseema AI Telephony <{from_header}>"
        msg["From"] = from_header
        msg["To"] = to_email

        if text_content:
            msg.attach(MIMEText(text_content, "plain", "utf-8"))
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        if cfg["use_ssl"]:
            server = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=15)
        else:
            server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=15)
            if cfg["use_tls"]:
                server.starttls()

        if cfg["user"] and cfg["password"]:
            server.login(cfg["user"], cfg["password"])

        # Extract envelope sender address
        sender_addr = cfg["user"]
        if not sender_addr:
            if "<" in cfg["from_email"]:
                sender_addr = cfg["from_email"].split("<")[-1].replace(">", "").strip()
            else:
                sender_addr = cfg["from_email"]

        server.sendmail(sender_addr, [to_email], msg.as_string())
        server.quit()
        logger.info(f"📧 Email successfully delivered to {to_email} (Subject: {subject})")
        return True
    except Exception as exc:
        logger.error(f"❌ Failed to deliver email to {to_email}: {exc}")
        return False

def send_activation_email(to_email: str, name: str, activation_url: str) -> bool:
    """Send account activation and initial password generation email to new employee."""
    subject = "Activate Your Swargaseema AI Telephony Account"
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }}
            .container {{ max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }}
            .header {{ background: #0f172a; padding: 24px 32px; color: #ffffff; text-align: center; }}
            .header h1 {{ margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.025em; }}
            .header p {{ margin: 6px 0 0; font-size: 13px; color: #94a3b8; }}
            .content {{ padding: 32px; }}
            .greeting {{ font-size: 16px; font-weight: 600; margin-bottom: 16px; }}
            .body-text {{ font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }}
            .button-container {{ text-align: center; margin: 32px 0; }}
            .btn {{ display: inline-block; background: #0284c7; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; }}
            .link-box {{ background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; word-break: break-all; color: #334155; margin-top: 16px; }}
            .footer {{ background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; text-align: center; font-size: 12px; color: #94a3b8; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Swargaseema AI Telephony</h1>
                <p>Employee Account Activation & Onboarding</p>
            </div>
            <div class="content">
                <div class="greeting">Hello {name or 'Team Member'},</div>
                <div class="body-text">
                    An account has been created for you on the <strong>Swargaseema AI Telephony</strong> platform.
                    To activate your account and set up your personal login password, please click the button below:
                </div>
                <div class="button-container">
                    <a href="{activation_url}" class="btn">Activate Account & Set Password</a>
                </div>
                <div class="body-text">
                    This link will expire in 48 hours. If the button above does not work, copy and paste this link into your browser:
                </div>
                <div class="link-box">{activation_url}</div>
            </div>
            <div class="footer">
                If you did not request or expect this account, please contact your administrator.
            </div>
        </div>
    </body>
    </html>
    """
    
    text = f"""Hello {name or 'Team Member'},

Your Swargaseema AI Telephony account has been created.
Please activate your account and set your password by visiting this link:

{activation_url}

This link is valid for 48 hours.
"""
    return send_email(to_email, subject, html, text)

def send_password_reset_email(to_email: str, name: str, reset_url: str) -> bool:
    """Send password reset link to employee or admin."""
    subject = "Reset Your Swargaseema AI Telephony Password"
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }}
            .container {{ max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }}
            .header {{ background: #0f172a; padding: 24px 32px; color: #ffffff; text-align: center; }}
            .header h1 {{ margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.025em; }}
            .header p {{ margin: 6px 0 0; font-size: 13px; color: #94a3b8; }}
            .content {{ padding: 32px; }}
            .greeting {{ font-size: 16px; font-weight: 600; margin-bottom: 16px; }}
            .body-text {{ font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }}
            .button-container {{ text-align: center; margin: 32px 0; }}
            .btn {{ display: inline-block; background: #e11d48; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; }}
            .link-box {{ background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; word-break: break-all; color: #334155; margin-top: 16px; }}
            .footer {{ background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; text-align: center; font-size: 12px; color: #94a3b8; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Swargaseema AI Telephony</h1>
                <p>Password Reset Request</p>
            </div>
            <div class="content">
                <div class="greeting">Hello {name or 'User'},</div>
                <div class="body-text">
                    We received a request to reset the password for your <strong>Swargaseema AI Telephony</strong> account ({to_email}).
                    Click the button below to choose a new password:
                </div>
                <div class="button-container">
                    <a href="{reset_url}" class="btn">Reset My Password</a>
                </div>
                <div class="body-text">
                    This link is valid for 2 hours. If you did not request a password reset, you can safely ignore this email.
                </div>
                <div class="link-box">{reset_url}</div>
            </div>
            <div class="footer">
                Swargaseema AI Telephony System Security
            </div>
        </div>
    </body>
    </html>
    """
    
    text = f"""Hello {name or 'User'},

We received a request to reset your Swargaseema AI Telephony password.
Click the link below to choose a new password:

{reset_url}

This link is valid for 2 hours.
"""
    return send_email(to_email, subject, html, text)
