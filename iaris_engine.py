import uvicorn
import sys
import os
from iaris.api import app

if __name__ == "__main__":
    # Standard IARIS entry point for standalone packaging
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
            
    print(f"[IARIS Backend] Starting server on port {port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
