import { useNavigate } from "react-router-dom";
import Icon from "./Icon";

export interface HubNode { id: string; title: string; sub: string; icon: string; state: "on" | "off" | "soon"; to?: string }

/** The centre piece: the system core with its modules around it and live status on every module. */
export default function Hub({ nodes }: { nodes: HubNode[] }) {
  const nav = useNavigate();
  const n = nodes.length;
  const pos = nodes.map((_, i) => {
    const a = (-90 + (360 / n) * i) * (Math.PI / 180);
    return { x: 50 + 39 * Math.cos(a), y: 50 + 38 * Math.sin(a) };
  });

  return (
    <div className="hub">
      <svg className="hub-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {pos.map((p, i) => <line key={nodes[i].id} x1="50" y1="50" x2={p.x} y2={p.y} className={`hub-line ${nodes[i].state}`} />)}
      </svg>
      <div className="hub-core" aria-label="هسته‌ی سیستم">
        <div className="core-ring r1" /><div className="core-ring r2" />
        <div className="core-body"><Icon name="activity" size={30} /><b>هسته‌ی سیستم</b><small>Robot Trading</small></div>
      </div>
      {nodes.map((nd, i) => (
        <button key={nd.id} className={`hub-node ${nd.state}`} style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%` }} onClick={() => nd.to && nav(nd.to)} disabled={!nd.to} aria-label={`${nd.title}: ${nd.sub}`}>
          <span className="hn-icon"><Icon name={nd.icon} size={20} /></span>
          <b>{nd.title}</b>
          <small>{nd.sub}</small>
          <i className="hn-dot" />
        </button>
      ))}
    </div>
  );
}
