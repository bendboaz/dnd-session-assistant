# Testing Conventions

## Frontend Testing

The frontend uses **vitest** for unit and integration tests.

### File Structure
- Test files are colocated with source code in `src/` with the `.test.ts` or `.test.tsx` extension
- Example: `src/components/Button.tsx` → `src/components/Button.test.tsx`

### Running Tests
From the project root (Windows PowerShell):
```powershell
npm test
```

To run tests in watch mode:
```powershell
npm test -- --watch
```

To generate coverage:
```powershell
npm test -- --coverage
```

## Backend Testing

The backend uses **pytest** for unit and integration tests.

### File Structure
- Test files are placed in `backend/tests/` directory
- Test files follow the naming convention `test_*.py`
- Example: `backend/tests/test_matching.py`, `backend/tests/test_token_storage.py`

### Running Tests
From the `backend/` directory (PowerShell or bash):
```powershell
# From project root, navigate to backend
cd backend
pip install -r requirements.txt
pytest
```

To run tests with verbose output:
```powershell
pytest -v
```

To run a specific test file:
```powershell
pytest tests/test_matching.py
```

To generate coverage:
```powershell
pytest --cov=. tests/
```

## Coverage Goals

We target meaningful coverage on:
- **Matching Logic**: The core D&D stat matching and lookup functionality in the matching module
- **Backend Token & Storage Logic**: Token counting and Firestore/database storage operations
- **Core Utilities**: Helper functions and utilities critical to the application

Aim for **70%+ coverage** on these critical paths. Use `npm test -- --coverage` and `pytest --cov` to monitor progress.

## CI Integration

Both test suites run automatically on:
- Pull requests
- Pushes to any branch
- See `.github/workflows/ci.yml` for details

Tests must pass before merging to main.
