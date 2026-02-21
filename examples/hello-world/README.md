# Hello World Example

**Difficulty:** Beginner
**Time:** 5 minutes
**Features:** Coding Agent, Plan-Review-Run Workflow

---

## Overview

This example demonstrates the basic BrightForge workflow by generating a simple "Hello, World!" function in JavaScript.

**What you'll learn:**
- How to run BrightForge via CLI
- Understanding the plan-review-run workflow
- Approving and applying code changes
- Using backup and rollback features

---

## Prerequisites

- Node.js 18+
- BrightForge installed
- Ollama with `qwen2.5-coder:14b` model (or any cloud API key)

---

## Instructions

### Step 1: Navigate to Example Directory

```bash
cd examples/hello-world
```

### Step 2: Run BrightForge

```bash
node ../../bin/brightforge.js "add a hello world function to index.js" --project .
```

### Step 3: Review the Plan

BrightForge will:
1. Scan the current directory
2. Generate a plan to create `index.js` with a hello world function
3. Show you a colored diff preview

**Example plan output:**

```
## FILE: index.js
## ACTION: create
## DESCRIPTION: Create new file with hello world function

+ function helloWorld() {
+   console.log('Hello, World!');
+ }
+
+ helloWorld();
```

### Step 4: Approve the Plan

When prompted:

```
Apply these changes? (y/n):
```

Type `y` and press Enter.

### Step 5: Verify the Result

Check that `index.js` was created:

```bash
cat index.js
```

Expected output:

```javascript
function helloWorld() {
  console.log('Hello, World!');
}

helloWorld();
```

### Step 6: Run the Code

```bash
node index.js
```

Expected output:

```
Hello, World!
```

---

## Backup and Rollback

BrightForge automatically creates backup files before making changes.

### View Backup

```bash
ls -la
```

You won't see a backup file because this was a **create** operation (no previous file to back up).

### Test Rollback

Make a modification:

```bash
node ../../bin/brightforge.js "make the hello world function return the string instead of logging it" --project .
```

Approve the change, then rollback:

```bash
node ../../bin/brightforge.js --rollback --project .
```

The file will be restored to its original state.

---

## Expected Output

### index.js (Initial)

```javascript
function helloWorld() {
  console.log('Hello, World!');
}

helloWorld();
```

### index.js (After Modification)

```javascript
function helloWorld() {
  return 'Hello, World!';
}

const message = helloWorld();
console.log(message);
```

---

## Variations

Try these alternative prompts:

```bash
# Add error handling
node ../../bin/brightforge.js "add try-catch error handling to the hello world function" --project .

# Add JSDoc comments
node ../../bin/brightforge.js "add JSDoc comments to all functions" --project .

# Convert to ES6
node ../../bin/brightforge.js "convert the hello world function to an arrow function" --project .

# Add unit tests
node ../../bin/brightforge.js "add unit tests for the hello world function using Node.js assert" --project .
```

---

## Troubleshooting

### "No LLM providers available"

**Cause:** Ollama not running or no API keys configured.

**Fix:**

```bash
# Option 1: Start Ollama
ollama serve
ollama pull qwen2.5-coder:14b

# Option 2: Add API key to .env.local
cp ../../.env.local.example ../../.env.local
# Edit ../../.env.local and add GROQ_API_KEY or GEMINI_API_KEY
```

### "Plan generation failed"

**Cause:** Network error or provider rate limit.

**Fix:**

- Check internet connection
- Wait 1 minute and retry (rate limit reset)
- Use a different provider by adding its API key to `.env.local`

### "Permission denied"

**Cause:** BrightForge doesn't have write permissions.

**Fix:**

```bash
# On Linux/Mac
chmod +w .

# On Windows
# Right-click folder → Properties → Security → Edit → Full control
```

---

## Next Steps

1. Try the [React Component](../react-component/) example (intermediate)
2. Explore the [Full-Stack App](../full-stack-app/) example (advanced)
3. Read [INSTALL.md](../../INSTALL.md) for advanced configuration

---

## License

MIT License - see [LICENSE](../../LICENSE) for details.
