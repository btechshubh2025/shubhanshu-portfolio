"""
Portfolio website: Flask + MySQL.

Run locally:   python app.py
Run in prod:   gunicorn app:app   (see README.md and the deploy/ folder)
"""
import hmac
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, url_for
from flask_sqlalchemy import SQLAlchemy
from werkzeug.middleware.proxy_fix import ProxyFix

import content

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

log = logging.getLogger("portfolio")

app = Flask(__name__)

# ---------------------------------------------------------------- configuration
# MySQL:   mysql+pymysql://USER:PASSWORD@HOST:3306/portfolio?charset=utf8mb4
# If DATABASE_URL is not set, a local SQLite file is used so the site runs out of the box.
_default_db = f"sqlite:///{BASE_DIR / 'instance' / 'portfolio.db'}"
(BASE_DIR / "instance").mkdir(exist_ok=True)

app.config.update(
    SQLALCHEMY_DATABASE_URI=os.getenv("DATABASE_URL") or _default_db,
    # RDS and MySQL close idle connections; these two keep the pool healthy.
    SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True, "pool_recycle": 280},
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    MAX_CONTENT_LENGTH=16 * 1024,  # contact form bodies are tiny
    SEND_FILE_MAX_AGE_DEFAULT=3600,  # browsers may cache CSS/JS/fonts for an hour
)

# Behind nginx / a load balancer, trust one hop of X-Forwarded-* headers
# so the real visitor IP and https scheme are seen.
if os.getenv("BEHIND_PROXY", "0") == "1":
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

db = SQLAlchemy(app)

# ---------------------------------------------------------------- database model


def _utcnow():
    # Stored as naive UTC, which is what MySQL DATETIME expects.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ContactMessage(db.Model):
    __tablename__ = "contact_messages"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(120), nullable=False)
    message = db.Column(db.Text, nullable=False)
    ip_address = db.Column(db.String(45), index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=_utcnow, index=True)


def init_db():
    """Create tables if they do not exist. Safe to call repeatedly."""
    with app.app_context():
        db.create_all()


try:
    init_db()
except Exception:  # the site must still load if the database is down
    log.exception("Could not initialise the database. The site will serve pages, but contact form will fail.")


@app.cli.command("init-db")
def init_db_command():
    """Create the database tables:  flask --app app init-db"""
    init_db()
    print("Database tables are ready.")


# ---------------------------------------------------------------- pages


@app.get("/")
def index():
    resume_file = BASE_DIR / "static" / "resume.pdf"
    return render_template(
        "index.html",
        c=content,
        year=datetime.now().year,
        resume_url=url_for("static", filename="resume.pdf") if resume_file.exists() else None,
    )


@app.get("/healthz")
def healthz():
    return jsonify(status="ok")


@app.errorhandler(404)
def not_found(_error):
    return render_template("404.html", c=content), 404


# ---------------------------------------------------------------- contact form

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

RATE_LIMIT_COUNT = 3  # messages ...
RATE_LIMIT_WINDOW = timedelta(minutes=10)  # ... per visitor, per window


def _clean(value):
    return CONTROL_CHARS_RE.sub("", (value or "")).strip() if isinstance(value, str) else ""


def validate_contact(data):
    name, email, message = _clean(data.get("name")), _clean(data.get("email")), _clean(data.get("message"))
    errors = {}
    if not 2 <= len(name) <= 80:
        errors["name"] = "Enter your name (2 to 80 characters)."
    if len(email) > 120 or not EMAIL_RE.match(email):
        errors["email"] = "Enter a valid email address so I can reply."
    if not 10 <= len(message) <= 2000:
        errors["message"] = "Write a message of 10 to 2000 characters."
    return {"name": name, "email": email, "message": message}, errors


@app.post("/api/contact")
def contact():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = request.form.to_dict()

    # Honeypot: real visitors never see or fill this field. Bots do.
    # Pretend it worked so the bot learns nothing.
    if _clean(data.get("website")):
        return jsonify(ok=True)

    values, errors = validate_contact(data)
    if errors:
        return jsonify(ok=False, errors=errors), 400

    ip = (request.remote_addr or "")[:45]
    try:
        since = _utcnow() - RATE_LIMIT_WINDOW
        recent = ContactMessage.query.filter(
            ContactMessage.ip_address == ip, ContactMessage.created_at >= since
        ).count()
        if recent >= RATE_LIMIT_COUNT:
            return (
                jsonify(ok=False, error="You've sent a few messages already. Please try again in about 10 minutes."),
                429,
            )
        db.session.add(ContactMessage(ip_address=ip, **values))
        db.session.commit()
    except Exception:
        db.session.rollback()
        log.exception("Saving a contact message failed")
        return (
            jsonify(ok=False, error=f"Couldn't save your message. Please email {content.PROFILE['email']} instead."),
            503,
        )

    return jsonify(ok=True)


# ---------------------------------------------------------------- admin inbox
# Set ADMIN_USER and ADMIN_PASSWORD in .env to turn this on. Without them
# /admin/messages returns 404, as if it did not exist.


def _admin_enabled():
    return bool(os.getenv("ADMIN_USER") and os.getenv("ADMIN_PASSWORD"))


def _admin_authorized():
    auth = request.authorization
    if not auth:
        return False
    user_ok = hmac.compare_digest((auth.username or "").encode(), os.environ["ADMIN_USER"].encode())
    pass_ok = hmac.compare_digest((auth.password or "").encode(), os.environ["ADMIN_PASSWORD"].encode())
    return user_ok and pass_ok


@app.get("/admin/messages")
def admin_messages():
    if not _admin_enabled():
        return not_found(None)
    if not _admin_authorized():
        return Response(
            "Login required.",
            401,
            {"WWW-Authenticate": 'Basic realm="Portfolio inbox"', "Cache-Control": "no-store"},
        )
    messages = ContactMessage.query.order_by(ContactMessage.created_at.desc()).limit(200).all()
    return render_template("admin_messages.html", messages=messages, c=content)


# ---------------------------------------------------------------- security headers

CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("Content-Security-Policy", CSP)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.is_secure:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    if request.path.startswith("/api/") or request.path.startswith("/admin/"):
        response.headers["Cache-Control"] = "no-store"
    return response


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "0") == "1", port=int(os.getenv("PORT", "5000")))
