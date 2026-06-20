# Loading Files for Models

Raven ADK provides utility functions to simplify loading local files (text, PDFs, images) for use with LLMs. These utilities handle encoding, MIME type detection, and distinguish between text-based and binary-based content.

## Utilities Overview

The file utilities are available via the `Utils` namespace or as direct exports from `@ravenlens/raven-adk`.

### `loadFileForModel`

The primary utility for loading documents. It automatically detects the file type and returns a structured object compatible with standard LLM input requirements.

```typescript
import { Utils } from "@ravenlens/raven-adk";

const result = await Utils.loadFileForModel("./docs/research.pdf");

// Result structure:
// {
//   content: "data:application/pdf;base64,...",
//   mimeType: "application/pdf",
//   type: "binary",
//   filename: "research.pdf"
// }
```

#### Supported Types:
- **Text**: `.txt`, `.md`, `.json`, `.ts`, `.js`, `.py`, etc.
- **Binary (Data URL)**: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`, `.gif`.
- **Special Cases**: Files like `LICENSE`, `NOTICE`, and `README` (without extensions) are automatically treated as text.

### `loadTextFile`

A simple wrapper for loading plain text files with UTF-8 encoding.

```typescript
import { Utils } from "@ravenlens/raven-adk";

const text = await Utils.loadTextFile("./README.md");
console.log(text);
```

### `loadFileAsDataUrl`

Loads a file and converts it to a Base64 Data URL. This is particularly useful for multimodal models (like Anthropic Claude 3.5 Sonnet) that accept PDF or images as base64 strings.

```typescript
import { Utils } from "@ravenlens/raven-adk";

const dataUrl = await Utils.loadFileAsDataUrl("./avatar.png");
// returns "data:image/png;base64,iVBOR..."
```

## Integration with Models

You can use these utilities to easily add files to your user messages:

```typescript
import { Utils, Model } from "@ravenlens/raven-adk";

const file = await Utils.loadFileForModel("./report.pdf");

const model = new Model.Anthropic({ ... });
const response = await model.invoke({
    messages: [{
        type: "user",
        content: "Analyze this report",
        fileInput: {
            file_data: file.content, // The base64 data URL
            filename: file.filename
        }
    }]
});
```

## Security Note

These utilities use `fs/promises` and are intended for server-side or local environment usage. Ensure that paths passed to these functions are validated if they come from untrusted user input.
