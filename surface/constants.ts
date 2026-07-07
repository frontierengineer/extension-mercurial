// hg log template: hash, short hash, author, unix ts, first line of desc.
export const LOG_TEMPLATE = '{node}\\t{node|short}\\t{author|person}\\t{date|hgdate}\\t{desc|firstline}\\n';

// Infer a Monaco language id from a file's extension for the side-by-side
// diff view. Small map — anything unknown falls back to plaintext (Monaco
// still renders it fine, just without syntax colouring).
export function inferLanguage(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': return 'typescript';
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'javascript';
    case 'json': return 'json';
    case 'md': case 'markdown': return 'markdown';
    case 'py': return 'python';
    case 'css': return 'css';
    case 'scss': return 'scss';
    case 'less': return 'less';
    case 'html': case 'htm': return 'html';
    case 'xml': return 'xml';
    case 'yaml': case 'yml': return 'yaml';
    case 'toml': return 'ini';
    case 'ini': case 'cfg': case 'conf': return 'ini';
    case 'sh': case 'bash': case 'zsh': return 'shell';
    case 'sql': return 'sql';
    case 'go': return 'go';
    case 'rs': return 'rust';
    case 'rb': return 'ruby';
    case 'php': return 'php';
    case 'java': return 'java';
    case 'kt': return 'kotlin';
    case 'swift': return 'swift';
    case 'c': case 'h': return 'c';
    case 'cpp': case 'cc': case 'cxx': case 'hpp': case 'hh': return 'cpp';
    case 'cs': return 'csharp';
    case 'dockerfile': return 'dockerfile';
    case 'graphql': case 'gql': return 'graphql';
    default:
      return file.toLowerCase().endsWith('dockerfile') ? 'dockerfile' : 'plaintext';
  }
}
