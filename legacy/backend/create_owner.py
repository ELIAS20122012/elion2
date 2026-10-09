"""One-off script to create the platform owner account (you).

There is no public signup endpoint on purpose -- this is a private platform.
Run once after the database is up:

    python create_owner.py you@example.com "your-password" "Your Name"
"""
import sys

from app import models
from app.database import Base, SessionLocal, engine
from app.security import hash_password

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: python create_owner.py <email> <password> [full_name]")
        sys.exit(1)

    email, password = sys.argv[1], sys.argv[2]
    full_name = sys.argv[3] if len(sys.argv) > 3 else None

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing = db.query(models.User).filter(models.User.email == email).first()
        if existing:
            print(f"User {email} already exists (id={existing.id})")
            sys.exit(0)

        user = models.User(
            email=email,
            hashed_password=hash_password(password),
            full_name=full_name,
            role=models.UserRole.owner,
        )
        db.add(user)
        db.commit()
        print(f"Created owner user {email} (id={user.id})")
    finally:
        db.close()
