import { ChevronRight, Info } from 'lucide-react';
import { resolveModelNode, type BrainRun, type NeuralEntity } from './living-brain';

const outcomeLabel = (outcome: string) => outcome.replaceAll('_', ' ');

export function ObservedRoute({ run, path, nodes, onInspect }: {
  run: BrainRun;
  path: string[];
  nodes: NeuralEntity[];
  onInspect: (id: string) => void;
}) {
  return <div className="observed-route">
    <strong>Observed route</strong>
    <ol className="observed-route-steps" aria-label="Observed route">
      {path.map((id, index) => {
        const node = nodes.find(item => item.id === id);
        if (!node) return null;
        return <li key={id}>
          {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
          <button type="button" onClick={() => onInspect(id)}>{node.kind === 'model' ? run.model ?? node.name : node.name}</button>
        </li>;
      })}
    </ol>
    {run.routeReason && <details className="observed-route-reason">
      <summary><Info size={15} aria-hidden="true" />{run.routeReason.replaceAll('_', ' ')}<span className="sr-only">. Explain routing decision</span></summary>
      <p>{run.routeReason.includes('Task needs structured work')
        ? 'Archindus classified this as a task that needs organization or multiple steps, such as writing code, analyzing information, or preparing a document. The router uses that classification with your settings and model availability to choose an engine.'
        : 'This is the recorded reason for the routing decision. The route above shows the specialist and engine recorded for this response. Any provider attempts recorded separately appear below.'}</p>
    </details>}
    {!!run.receipt?.attempts.length && <details className="observed-route-attempts">
      <summary>Model attempts ({run.receipt.attempts.length})</summary>
      <ol>{run.receipt.attempts.map((attempt, index) => {
        const id = resolveModelNode(attempt.model, nodes);
        return <li key={index}>{id ? <button type="button" onClick={() => onInspect(id)}>{attempt.model}</button> : attempt.model}
          {' · '}{outcomeLabel(attempt.outcome)}{' · '}{(attempt.elapsedMs / 1000).toFixed(1)}s
          {attempt.chargedMicrodollars !== undefined && ' · ' + (attempt.chargedMicrodollars === 0 ? '$0' : 'Estimated $' + (attempt.chargedMicrodollars / 1_000_000).toFixed(6))}
        </li>;
      })}</ol>
    </details>}
  </div>;
}
