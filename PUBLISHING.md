# What todo to publish the package


> MonoRepo Environment: This package origninally was made in Monorepo hence it's to use some specific commands are listed below to allow to publish the changes

## Use these commands to publish the package to a community or locally to a team:

1. To npm Registry (Public/Community):
Use this command to publish the package to the npm registry
```bash
npm publish --@ravenlens:registry=https://registry.npmjs.org/ --access public
```

2. To GitHub Packages (Private/Internal):
```bash
npm publish --registry=https://npm.pkg.github.com/
```

## Instruction TODO
- Setup Valid tokens `NPM_TOKEN` and `GITHUB_PACKAGES_TOKEN` to be in the same session