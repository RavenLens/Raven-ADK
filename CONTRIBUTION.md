# Contributing to RavenADK

First off, thank you for considering contributing to RavenADK! It's people like you that make RavenADK such a great tool for the AI-Agent development community.

RavenADK is an open-source Agent Development Kit designed to support wild AI-Agent initiatives, with a strong focus on event-driven architectures and delightful UI/UX.

## How to Become a Contributor

Contributions are welcome in the form of bug fixes, tests, documentation, examples, integrations, and new agent capabilities. A useful contribution usually follows this flow:

1. **Find or open an issue.** Search the [issue tracker](https://github.com/RavenLens/Raven-SDK/issues) first. For a new bug or feature, open an issue with enough context for someone else to reproduce or evaluate it.
    - **Important:** For Openning New Issue & Resolving Existsing - ensure problem occurs and isn't already resolved by checking out the [codebase](./src/) and [documentation](./documentation/)
2. **Discuss the scope when needed.** Larger changes, public API changes, new dependencies, and behavior changes should be agreed on in the issue before implementation.
3. **Fork and create a branch.** Branch from `main` with a focused name such as `fix/tool-timeout` or `feat/memory-adapter`.
4. **Make a focused change.** Follow the existing TypeScript structure and preserve public APIs unless the change requires an intentional breaking change.
5. **Add or update tests.** Cover new behavior and regression cases in `test/`. Keep tests deterministic and avoid committing credentials or provider-specific secrets.
6. **Update documentation.** Changes to public behavior should include the relevant documentation or examples under `documentation/` and, when appropriate, `README.md`.
7. **Run the checks locally.** Run `npm run build` and `npm test` from this package directory before opening the pull request.
8. **Open a pull request.** Summarize the problem, the solution, tests run, documentation changes, and any compatibility or follow-up considerations. Link the related issue.

## Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct. Please be respectful and professional in all interactions.

## Contribution Areas

### Reporting Bugs

* Check the [GitHub Issues](https://github.com/RavenLens/Raven-SDK/issues) to see if the bug has already been reported.
* If not, open a new issue. Include a clear title, a description of the problem, steps to reproduce, and any relevant logs or screenshots.

### Suggesting Enhancements

* Open a [GitHub Issue](https://github.com/RavenLens/Raven-SDK/issues) with the tag "enhancement".
* Provide a clear description of the proposed feature and why it would be beneficial.

### Pull Requests

Before opening a pull request, confirm that:

* The change has a clear purpose and is limited to the relevant files.
* Public API or behavior changes are documented.
* Tests cover the changed behavior and pass locally.
* `npm run build` succeeds.
* The pull request description explains the motivation, implementation, validation, and any remaining limitations.
* Breaking changes and changes to generated or published output are called out clearly.

Keep review discussion focused on correctness, compatibility, maintainability, and the user-facing behavior of RavenADK.

## Development Setup

### Prerequisites

* [Node.js](https://nodejs.org/) (Latest LTS recommended)
* [npm](https://www.npmjs.com/)

### Installation

From a clone of the upstream repository:

```bash
git clone https://github.com/RavenLens/Raven-SDK.git
cd Raven-SDK/ravenone-related/libs/Raven\ ADK
npm install
```

On Windows PowerShell, use:

```powershell
Set-Location "Raven-SDK/ravenone-related/libs/Raven ADK"
npm install
```

If you are already working in this package directory, run `npm install` directly.

### Building

To compile the TypeScript code:

```bash
npm run build
```

### Running Tests

We use [Vitest](https://vitest.dev/) for testing. Run the package script:

```bash
npm test
```

To run a focused test file or pass Vitest options, use `npx vitest` followed by the desired arguments. Please ensure all relevant tests pass before submitting a pull request. If you add new functionality, add corresponding tests in the `test/` directory.

## Coding Guidelines

* **TypeScript**: Use TypeScript for new library code and keep public types explicit and stable.
* **Style**: Follow the existing code style. Keep changes focused, readable, and free of unrelated formatting churn.
* **Tests**: Add regression coverage for bug fixes and behavior coverage for new functionality.
* **Events**: RavenADK is event-driven. Emit relevant events when a new observable operation needs to be available to UI or other integrations.
* **Dependencies**: Add a dependency only when it is necessary and compatible with the package's supported runtime. Explain meaningful dependency or bundle-size changes in the pull request.
* **Documentation**: If you change public behavior, update the relevant documentation in `documentation/` and examples where appropriate.
* **Security**: Do not commit API keys, credentials, private data, or unreviewed code-execution paths. Report security issues privately rather than opening a public issue.

## Commit Messages

* Use clear and descriptive commit messages.
* Prefer [Conventional Commits](https://www.conventionalcommits.org/), for example `fix: handle tool timeout` or `docs: clarify memory configuration`.
* Reference issues when applicable, for example `fix: handle tool timeout (#123)`.
* Keep commits focused so they are easy to review and revert.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](https://github.com/RavenLens/Raven-ADK/blob/main/documentation/LICENSE/README.md).
