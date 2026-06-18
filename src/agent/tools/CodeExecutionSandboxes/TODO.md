## Implement Judge0 (judge-zero) sandbox integration

#### Use below AI answer and judge-zero docs to connect sandbox with it (https://ce.judge0.com/#top)
TODO: Mention the fact of judge0 integration in Sadnbox document

Judge0 does not have a built-in graphical user interface (Frontend). It is strictly a headless **REST API**. When you visit the root URL (`/`) in your browser, there is no HTML page to render, hence the blank white screen.

To use Judge0, your AI agent (or you) must interact with it by sending HTTP requests to its specific endpoints. 

Here is exactly how to verify your Railway deployment is working and how to start sending code to it.

### Step 1: Verify your deployment is working
To check if Judge0 is alive, append `/about` or `/languages` to your Railway deployment URL in your browser:
*   `https://<your-railway-url>.up.railway.app/about` -> This will return a JSON response with version info.
*   `https://<your-railway-url>.up.railway.app/languages` -> This will return a JSON list of all supported programming languages and their corresponding `id`s.

*Note: You will need the language `id` to execute code. For example, Python (3.8.1) is usually ID `71`, and Node.js is usually ID `74`.*

---

### Step 2: Execute Code (The API Workflow)
The easiest way for an AI agent to use Judge0 is to send a **synchronous** request. This means you send the code, and the connection stays open until Judge0 finishes running the code and returns the console output.

You do this by making a `POST` request to `/submissions?wait=true`.

Here are three ways to test it right now:

#### Option A: Using cURL (Terminal)
Open your terminal and run this command (replace the URL with your Railway URL). This runs a simple Python script (`print('Hello from Railway!')`).

```bash
curl -X POST "https://<your-railway-url>.up.railway.app/submissions?base64_encoded=false&wait=true" \
     -H "Content-Type: application/json" \
     -d '{
           "source_code": "print(\"Hello from Railway!\")",
           "language_id": 71
         }'
```

#### Option B: Using Python (`requests`)
If your AI agent is written in Python, here is the exact function you can give it to execute generated code:

```python
import requests

def execute_code(agent_code_string, language_id=71):
    # Base URL of your Railway Judge0 deployment
    JUDGE0_URL = "https://<your-railway-url>.up.railway.app"
    
    payload = {
        "source_code": agent_code_string,
        "language_id": language_id, # 71 is Python
        # "stdin": "User input if your code requires it"
    }

    # ?wait=true tells Judge0 to finish running before responding
    response = requests.post(
        f"{JUDGE0_URL}/submissions?base64_encoded=false&wait=true",
        json=payload
    )

    result = response.json()
    
    # Judge0 returns stdout (print statements), stderr (errors), and compile_output
    if result.get("stderr"):
        return f"Error: {result['stderr']}"
    elif result.get("compile_output"):
        return f"Compiler Error: {result['compile_output']}"
    else:
        return result.get("stdout", "No output")

# Test it
code_to_run = """
def calculate(a, b):
    return a + b
print("Agent Calculation:", calculate(5, 10))
"""

print(execute_code(code_to_run))
```

#### Option C: Using JavaScript / TypeScript
If your agent is built in JS/TS:

```javascript
async function runCode(codeString) {
  const response = await fetch('https://<your-railway-url>.up.railway.app/submissions?base64_encoded=false&wait=true', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      source_code: codeString,
      language_id: 74 // 74 is usually Node.js
    })
  });

  const data = await response.json();
  console.log("Output:", data.stdout);
  console.log("Errors:", data.stderr);
}

runCode('console.log("Hello from Judge0 on Railway!");');
```

---

### Important Railway Deployment Notes:

1. **Authentication:** If you deployed Judge0 using a standard Railway template, it likely generated an `AUTH_TOKEN` in your Railway Environment Variables to protect your server from being used by random people. Check your Railway dashboard variables for `AUTH_TOKEN`. If it exists, you MUST pass it in the headers of your requests like this:
   `"X-Auth-Token": "your_secret_token_here"`
2. **Base64 Encoding:** In the examples above, I used `base64_encoded=false` to make testing easy. In production, AI agents sometimes generate code with weird line breaks, quotes, or escape characters that break standard JSON payloads. It is highly recommended to encode the agent's code in Base64, set `"source_code"` to that base64 string, and change the query URL to `base64_encoded=true`.
3. **Database limits:** Judge0 stores submissions in a PostgreSQL database (and uses Redis). On Railway, be mindful of your database limits over time as your agent runs thousands of code executions, as every execution is logged in the DB.