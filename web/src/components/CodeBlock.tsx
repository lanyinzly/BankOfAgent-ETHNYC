import { useState } from 'react';

interface Props {
  code: string;
  lang?: string;
}

export default function CodeBlock({ code, lang }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="code">
      <div className="code__bar">
        {lang && <span className="code__lang">{lang}</span>}
        <button className="code__copy" onClick={copy} type="button">
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      <pre className="code__pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}
