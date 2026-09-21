import logging
import time

from redis.exceptions import RedisError
from fastapi import Request, HTTPException

from config import REDIS_PREFIX
from utils.redis_utils import get_redis_client

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 40      # requests per IP
DEFAULT_WINDOW = 3600   # seconds

# ponytail: fixed-window counter per IP, process-local. Redis is the real
# implementation; this exists so a public deployment without Redis is still
# not an unmetered proxy to a billed OpenAI account. Single worker only —
# run Redis (or one worker) if you care about the limit being exact.
_hits = {}


def _memory_rate_limit(client_ip: str, limit: int, window: int) -> bool:
    now = time.time()
    count, started = _hits.get(client_ip, (0, now))

    if now - started >= window:
        count, started = 0, now

    if count >= limit:
        return False

    _hits[client_ip] = (count + 1, started)

    # Drop expired entries so a long-running process doesn't grow unbounded.
    if len(_hits) > 5000:
        for ip, (_, ts) in list(_hits.items()):
            if now - ts >= window:
                _hits.pop(ip, None)

    return True


def check_api_rate_limit(client_ip: str, limit: int = DEFAULT_LIMIT, window: int = DEFAULT_WINDOW) -> bool:
    """Check if client IP has exceeded API rate limit"""
    redis_client = get_redis_client()
    if redis_client is None:
        return _memory_rate_limit(client_ip, limit, window)

    try:
        key = f"{REDIS_PREFIX}ratelimit:{client_ip}"
        current = redis_client.get(key)

        if current is None:
            redis_client.set(key, 1, ex=window)
            return True

        if int(current) >= limit:
            return False

        redis_client.incr(key)
        return True
    except RedisError as e:
        logger.error(f"Redis error in rate limiting: {e}")
        return _memory_rate_limit(client_ip, limit, window)


def get_client_ip(request: Request) -> str:
    """Get client IP address considering proxy headers"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def rate_limit_dependency(request: Request):
    """FastAPI dependency for rate limiting"""
    client_ip = get_client_ip(request)
    if not check_api_rate_limit(client_ip):
        raise HTTPException(
            status_code=429,
            detail="You've hit the hourly limit for this address. Try again in a little while."
        )
    return client_ip
