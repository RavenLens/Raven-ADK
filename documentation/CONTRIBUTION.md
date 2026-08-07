# Contributing to RavenADK

First off, thank you for considering contributing to RavenADK! It's people like you that make RavenADK such a great tool for the AI-Agent development community.

RavenADK is an open-source Agent Development Kit designed to support wild AI-Agent initiatives, with a strong focus on event-driven architectures and delightful UI/UX.

## Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct. Please be respectful and professional in all interactions.

## How Can I Contribute?

### Reporting Bugs

* Check the [GitHub Issues](https://github.com/RavenLens/Raven-SDK/issues) to see if the bug has already been reported.
* If not, open a new issue. Include a clear title, a description of the problem, steps to reproduce, and any relevant logs or screenshots.

### Suggesting Enhancements

* Open a [GitHub Issue](https://github.com/RavenLens/Raven-SDK/issues) with the tag "enhancement".
* Provide a clear description of the proposed feature and why it would be beneficial.

### Pull Requests

1. **Fork** the repository and create your branch from `main`.
2. **Setup** the development environment (see below).
3. **Draft** your changes.
4. **Test** your changes to ensure they don't break existing functionality.
5. **Submit** a Pull Request with a clear description of the changes and references to any related issues.

## Development Setup

### Prerequisites

* [Node.js](https://nodejs.org/) (Latest LTS recommended)
* [npm](https://www.npmjs.com/)

### Installation

```bash
git clone https://github.com/RavenLens/Raven-SDK.git
cd ravenone-related/libs/Raven%20ADK
npm install
```

### Building

To compile the TypeScript code:

```bash
npm run build
```

### Running Tests

We use [Vitest](https://vitest.dev/) for testing. Although the `package.json` script might be currently minimal, you can run tests using:

```bash
npx vitest
```

Please ensure all tests pass before submitting a Pull Request. If you add new functionality, please add corresponding tests in the `test/` directory.

## Coding Guidelines

* **TypeScript**: Use TypeScript for all new code. Ensure types are properly defined.
* **Style**: Follow the existing code style. We aim for clean, readable, and well-documented code.
* **Events**: Since RavenADK is strongly based on events, ensure new features properly emit events where appropriate to support UI/UX integrations.
* **Documentation**: If you change or add functionality, update the relevant documentation in the `documentation/` folder.

## Commit Messages

* Use clear and descriptive commit messages.
* Reference issues if applicable (e.g., `fix: #123 resolve memory leak in ChromaDB store`).
* Follow [Conventional Commits](https://www.conventionalcommits.org/) if possible.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](https://github.com/RavenLens/Raven-ADK/blob/main/documentation/LICENSE/README.md).
