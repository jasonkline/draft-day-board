import { useState } from "react";
import { absUrl } from "../lib/util";

interface Props {
  code: string;
}

function CopyRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="share-row">
      <div className="share-label">{label}</div>
      <div className="share-url">{url}</div>
      <button
        className="btn btn-small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard may be blocked; the URL is shown anyway */
          }
        }}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

export function ShareLinks({ code }: Props) {
  return (
    <div className="share">
      <div className="share-code">
        <span>Draft code</span>
        <strong>{code}</strong>
      </div>
      <CopyRow label="📺 TV Board" url={absUrl(`/board/${code}`)} />
      <CopyRow label="📱 Player join" url={absUrl(`/play/${code}`)} />
      <p className="hint">
        Players open the join link (or enter the code on the home page) to grab
        their team and pick from their phone.
      </p>
    </div>
  );
}
