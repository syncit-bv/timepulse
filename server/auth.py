import os
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
_bearer    = HTTPBearer()


async def require_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    if not JWT_SECRET:
        raise HTTPException(500, "SUPABASE_JWT_SECRET niet geconfigureerd")
    try:
        payload = jwt.decode(
            creds.credentials,
            JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return {"user_id": payload["sub"], "email": payload.get("email", "")}
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token verlopen — log opnieuw in")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Ongeldig token")
