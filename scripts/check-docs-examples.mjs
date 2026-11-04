import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(ROOT, 'packages');
const DOCS = join(ROOT, 'docs');
const DOCS_DIRECTORIES_THAT_ARE_NOT_PAGES = new Set(['node_modules', 'build', 'src', 'static']);
const VIRTUAL_DIR = join(ROOT, '.docs-examples');

const filesUnder = (directory, keep, skipDirectory = () => false) =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
            const skipped = entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name.startsWith('_');
            return skipped || skipDirectory(entry.name) ? [] : filesUnder(full, keep, skipDirectory);
        }
        return keep(entry.name) ? [full] : [];
    });

const packageDirectories = readdirSync(PACKAGES).filter(name => existsSync(join(PACKAGES, name, 'package.json')));

const docs = [
    join(ROOT, 'README.md'),
    ...packageDirectories.map(name => join(PACKAGES, name, 'README.md')).filter(path => existsSync(path)),
    ...filesUnder(
        DOCS,
        name => name.endsWith('.md') || name.endsWith('.mdx'),
        name => DOCS_DIRECTORIES_THAT_ARE_NOT_PAGES.has(name),
    ),
].filter(path => existsSync(path));

const FENCE = /^\s*```(\S*)\s*(\S*)/;
const EXAMPLE_LANGUAGES = new Set(['ts', 'typescript', 'tsx']);

const blocksOf = (path) => {
    const lines = readFileSync(path, 'utf8').split('\n');
    const blocks = [];
    let open;
    for (let i = 0; i < lines.length; i++) {
        const fence = lines[i].match(FENCE);
        if (fence === null) {
            if (open !== undefined) open.lines.push(lines[i]);
            continue;
        }
        if (open === undefined) {
            open = { language: fence[1], role: fence[2], firstLine: i + 2, lines: [] };
            continue;
        }
        if (EXAMPLE_LANGUAGES.has(open.language)) blocks.push(open);
        open = undefined;
    }
    return blocks;
};

const virtualFiles = new Map();
for (const doc of docs) {
    const where = relative(ROOT, doc);
    const blocks = blocksOf(doc);
    const docDirectory = join(VIRTUAL_DIR, where.replace(/[^\w]/g, '_'));
    for (const block of blocks.filter(candidate => candidate.role.startsWith('file='))) {
        const text = ['export {};', ...block.lines];
        const origin = [undefined, ...block.lines.map((_, k) => `${where}:${block.firstLine + k}`)];
        const filePath = join(docDirectory, block.role.slice('file='.length).replace(/\.ts$/, '.tsx'));
        virtualFiles.set(filePath, { text: text.join('\n'), origin, doc: where });
    }
    const setup = blocks.filter(block => block.role === 'setup');
    const examples = blocks.filter(block =>
        block.role !== 'setup' && block.role !== 'signature' && !block.role.startsWith('file='));
    const units = examples.length > 0 ? examples : setup.length > 0 ? [undefined] : [];
    units.forEach((example, n) => {
        const text = ['export {};'];
        const origin = [undefined];
        for (const block of example === undefined ? setup : [...setup, example]) {
            block.lines.forEach((line, k) => { text.push(line); origin.push(`${where}:${block.firstLine + k}`); });
        }
        virtualFiles.set(join(VIRTUAL_DIR, `${where.replace(/[^\w]/g, '_')}__${n}.tsx`), { text: text.join('\n'), origin, doc: where });
    });
}

const paths = {};
for (const directory of packageDirectories) {
    const index = ['index.ts', 'index.tsx'].map(name => join(PACKAGES, directory, 'src', name)).find(existsSync);
    const manifestPath = join(PACKAGES, directory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const { name, exports } = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (index !== undefined) paths[name] = [index];
    for (const subpath of Object.keys(exports ?? {})) {
        if (subpath === '.' || !subpath.startsWith('./') || subpath.includes('*')) continue;
        const relative = subpath.slice(2);
        const source = [`${relative}/index.ts`, `${relative}/index.tsx`, `${relative}.ts`, `${relative}.tsx`]
            .map(candidate => join(PACKAGES, directory, 'src', candidate))
            .find(existsSync);
        if (source !== undefined) paths[`${name}/${relative}`] = [source];
    }
}
const OIMDB_PACKAGES = join(ROOT, 'docs', 'node_modules', '@oimdb');
for (const directory of readdirSync(OIMDB_PACKAGES)) {
    const { exports } = JSON.parse(readFileSync(join(OIMDB_PACKAGES, directory, 'package.json'), 'utf8'));
    for (const [subpath, target] of Object.entries(exports ?? { '.': {} })) {
        if (typeof target.types !== 'string') throw new Error(`@oimdb/${directory} export ${subpath} has no types`);
        paths[join(`@oimdb/${directory}`, subpath)] = [join(OIMDB_PACKAGES, directory, target.types)];
    }
}

const MODULES_THIS_REPO_DOES_NOT_INSTALL = ['@nestjs/common', '@nestjs/schedule', 'limiter'];
virtualFiles.set(join(VIRTUAL_DIR, 'modules-this-repo-does-not-install.d.ts'), {
    text: MODULES_THIS_REPO_DOES_NOT_INSTALL.map(name => `declare module '${name}';`).join('\n'),
    origin: [],
});

const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    strict: true,
    experimentalDecorators: true,
    noEmit: true,
    skipLibCheck: true,
    baseUrl: ROOT,
    paths,
    types: ['node'],
};

const host = ts.createCompilerHost(options);
const readFile = host.readFile.bind(host);
const fileExists = host.fileExists.bind(host);
const getSourceFile = host.getSourceFile.bind(host);
host.readFile = path => virtualFiles.get(path)?.text ?? readFile(path);
host.fileExists = path => virtualFiles.has(path) || fileExists(path);
const directoryExists = host.directoryExists?.bind(host);
host.directoryExists = path => path.startsWith(VIRTUAL_DIR) || (directoryExists === undefined ? true : directoryExists(path));
host.getSourceFile = (path, languageVersion, ...rest) => {
    const virtual = virtualFiles.get(path);
    return virtual === undefined
        ? getSourceFile(path, languageVersion, ...rest)
        : ts.createSourceFile(path, virtual.text, languageVersion, true, ts.ScriptKind.TSX);
};

const packageIndexes = Object.values(paths).flat().filter(path => path.startsWith(PACKAGES));
const program = ts.createProgram([...virtualFiles.keys(), ...packageIndexes], options, host);
const problems = new Set();

const sourceDirectories = packageDirectories
    .flatMap(name => ['src', 'bin'].map(part => join(PACKAGES, name, part)))
    .filter(directory => existsSync(directory));
const workspaceSources = sourceDirectories
    .flatMap(directory => filesUnder(directory, name => /\.(?:tsx?|c?js|mjs)$/.test(name)))
    .map(path => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true));

const NAMES_THAT_LIVE_OUTSIDE_THE_WORKSPACE = {
    enableShutdownHooks: 'NestJS INestApplication, a peer this repo does not install',
    jsxDEV: 'the React development JSX runtime the benchmark profiled',
    useObserver: 'mobx-react-lite, a benchmark contender',
    useStoreMap: 'effector-react, a benchmark contender',
    createEntityAdapter: 'Redux Toolkit, a benchmark contender',
    createInPlaceEntityUpdater: 'the OIMDB 3.x writer the published benchmark ran on',
};
const knownNames = new Set(Object.keys(NAMES_THAT_LIVE_OUTSIDE_THE_WORKSPACE));
for (const sourceFile of [...program.getSourceFiles().filter(file => !virtualFiles.has(file.fileName)), ...workspaceSources]) {
    const visit = (node) => {
        if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) knownNames.add(node.text.replace(/^#/, ''));
        else if (ts.isStringLiteralLike(node)) knownNames.add(node.text);
        else if (ts.isTemplateExpression(node)) {
            for (const part of [node.head, ...node.templateSpans.map(span => span.literal)]) {
                for (const word of part.text.match(/[A-Za-z_$][\w$]*/g) ?? []) knownNames.add(word);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
}

const namesDeclaredByDoc = new Map();
for (const sourceFile of program.getSourceFiles()) {
    const doc = virtualFiles.get(sourceFile.fileName)?.doc;
    if (doc === undefined) continue;
    const names = namesDeclaredByDoc.get(doc) ?? new Set();
    const visit = (node) => {
        if (ts.isIdentifier(node)) names.add(node.text);
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    namesDeclaredByDoc.set(doc, names);
}

const CODE_SPAN = /`([^`\n]+)`/g;
const QUOTED = /(['"])(?:(?!\1).)*\1/g;
const NAME = /(\.)?\b([A-Za-z_$][\w$]*)\b(\s*\()?/g;
const looksLikeCode = (name, afterDot, beforeCall) =>
    afterDot || beforeCall || /[a-z][A-Z]/.test(name) || /^[A-Z][a-z]/.test(name) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(name);
const isPathOrCommand = (span) => /\/\w|\.(?:ts|tsx|md|mjs|cjs|js|json|txt|css|html)\b|^(?:npm|npx|node|git|cd)\s/.test(span);

const namesIn = (text) => {
    const found = [];
    for (const match of text.replace(QUOTED, '').matchAll(NAME)) {
        const [, afterDot, name, beforeCall] = match;
        if (ts.stringToToken(name) !== undefined) continue;
        if (looksLikeCode(name, afterDot !== undefined, beforeCall !== undefined)) found.push(name);
    }
    return found;
};

for (const doc of docs) {
    const where = relative(ROOT, doc);
    const lines = readFileSync(doc, 'utf8').split('\n');
    let fence;
    for (let i = 0; i < lines.length; i++) {
        const opened = lines[i].match(FENCE);
        if (opened !== null) {
            fence = fence === undefined ? { language: opened[1], role: opened[2] } : undefined;
            continue;
        }
        const pieces = fence === undefined
            ? [...lines[i].matchAll(CODE_SPAN)].map(span => span[1]).filter(span => !isPathOrCommand(span))
            : EXAMPLE_LANGUAGES.has(fence.language) && fence.role === 'signature' ? [lines[i].replace(/\/\/.*$/, '')] : [];
        for (const piece of pieces) {
            for (const name of namesIn(piece)) {
                if (!knownNames.has(name) && !namesDeclaredByDoc.get(where)?.has(name)) problems.add(`${where}:${i + 1}: names \`${name}\`, which no source declares`);
            }
        }
    }
}

for (const diagnostic of [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]) {
    const file = diagnostic.file;
    const virtual = file === undefined ? undefined : virtualFiles.get(file.fileName);
    if (virtual === undefined) continue;
    const { line } = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    problems.add(`${virtual.origin[line] ?? relative(ROOT, file.fileName)}: ${message}`);
}

const sorted = [...problems].sort();
for (const problem of sorted) console.log(problem);
console.log(`${virtualFiles.size} examples from ${docs.length} docs: ${sorted.length} problem(s)`);
process.exit(sorted.length === 0 ? 0 : 1);
