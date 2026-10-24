"""
Unified test runner for Universal Translator.
Runs backend unit tests and frontend content logic tests.
"""
import subprocess
import sys
import os
import unittest

def run_all():
    print("=" * 60)
    print("UNIVERSAL TRANSLATOR - UNIFIED TEST SUITE")
    print("=" * 60)

    # 1. Run Node.js Content Logic Tests
    print("\n[Step 1/2] Running Frontend Content Script Logic Tests...")
    node_test_path = os.path.join(os.path.dirname(__file__), "test_content_logic.js")
    result = subprocess.run(["node", node_test_path], capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print("Frontend tests failed:")
        print(result.stderr)
        sys.exit(1)

    # 2. Run Backend Unit Tests
    print("[Step 2/2] Running Backend FastAPI & Translator Tests...")
    backend_root = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend")
    if backend_root not in sys.path:
        sys.path.insert(0, backend_root)

    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=os.path.join(backend_root, "app", "tests"))
    runner = unittest.TextTestRunner(verbosity=2)
    test_result = runner.run(suite)

    if not test_result.wasSuccessful():
        print("Backend tests failed!")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED SUCCESSFULLY! (Frontend & Backend)")
    print("=" * 60)

if __name__ == "__main__":
    run_all()
