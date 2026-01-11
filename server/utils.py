import random
import string
from datetime import datetime, timezone


def gen_id(n=10):
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(n))


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
