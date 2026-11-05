"use client";

import { useEffect, useRef, type RefObject } from "react";

export type OracleState = "idle" | "working" | "responding" | "speaking" | "error";
import { nearestGraph, type Point } from "./neural-topology";
type Spark = { a: number; b: number; travel: number; hops: number };

/** Token arrivals and spoken words trigger connected firing paths on a light canvas. */
export function NeuralNetwork({ state, activity }: { state: OracleState; activity: RefObject<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !ctx) return;
    let seed = 21731;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const count = window.innerWidth < 640 ? 300 : 540;
    const points: Point[] = Array.from({ length: count }, (_, i) => {
      const y = 1 - 2 * ((i + 0.5) / count), angle = i * Math.PI * (3 - Math.sqrt(5));
      const ring = Math.sqrt(1 - y * y), radius = 0.63 + random() * 0.37;
      return { x: Math.cos(angle) * ring * radius * (1 + 0.07 * Math.sin(angle * 3 + y * 5)), y: y * radius, z: Math.sin(angle) * ring * radius, size: 0.5 + random() * 1.15 };
    });
    const {edges,neighbors} = nearestGraph(points);
    const charge = new Float32Array(points.length);
    const sparks: Spark[] = [];
    const waves: Array<{ age: number; origin: Point }> = [];
    const ignite = (node: number, hops = 3) => {
      charge[node] = 1;
      for (const next of neighbors[node].slice(0, 3)) {
        if (sparks.length < 80) sparks.push({ a: node, b: next, travel: 0, hops });
      }
    };
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 600, height = 600, frame = 0, lastFrame = 0, elapsed = 0, rotation = 0;
    let pointerX = 0, pointerY = 0, lastState = "", lastActivity = 0, lastBurst = 0, energy = 0;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect(); width = bounds.width; height = bounds.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const pointer = (event: PointerEvent) => {
      pointerX = (event.clientX / window.innerWidth - 0.5) * 0.14;
      pointerY = (event.clientY / window.innerHeight - 0.5) * 0.1;
    };
    window.addEventListener("pointermove", pointer, { passive: true });

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const current = stateRef.current, active = ["working", "responding", "speaking"].includes(current);
      if (document.hidden || now - lastFrame < (motion.matches ? 250 : 1000 / (active ? 40 : 24))) return;
      const delta = Math.min((now - lastFrame) / 1000, 0.07); lastFrame = now;
      const dt = motion.matches ? 0 : delta; elapsed += dt;
      const changed = current !== lastState, arrived = activity.current !== lastActivity;
      if ((changed || arrived || elapsed - lastBurst > (active ? 0.42 : 2.8)) && !motion.matches) {
        const node = Math.floor(random() * points.length);
        ignite(node, active ? 4 : 1);
        if (active) { ignite((node + 180) % points.length); waves.push({ age: 0, origin: points[node] }); }
        if (waves.length > 5) waves.shift();
        energy = Math.max(energy, active ? 1 : 0.2); lastBurst = elapsed;
      }
      lastState = current; lastActivity = activity.current; energy *= Math.exp(-dt * 3.2);
      rotation += dt * (active ? 0.105 : 0.04);
      const yaw = rotation + (motion.matches ? 0 : pointerX), tilt = -0.15 + (motion.matches ? 0 : pointerY);
      const size = Math.min(width, height) * 0.405 * (1 + energy * 0.025);
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < charge.length; i++) charge[i] *= Math.exp(-dt * 3.6);
      waves.forEach(wave => { wave.age += dt; });
      const cy=Math.cos(yaw), sy=Math.sin(yaw), ct=Math.cos(tilt), st=Math.sin(tilt);
      const projected = points.map((p, i) => {
        let waveEnergy = 0;
        if (!motion.matches) for (const wave of waves) {
          const distance = Math.hypot(p.x - wave.origin.x, p.y - wave.origin.y, p.z - wave.origin.z);
          waveEnergy += Math.max(0, 1 - Math.abs(distance - wave.age * 1.6) / 0.15) * Math.max(0, 1 - wave.age / 1.6);
        }
        const x = (p.x * cy - p.z * sy) * (1 + waveEnergy * 0.025);
        const z = p.x * sy + p.z * cy;
        const y = p.y * ct - z * st;
        const depth = p.y * st + z * ct, perspective = 3.8 / (3.8 - depth);
        return { x: width / 2 + x * size * perspective, y: height / 2 + y * size * perspective + Math.sin(elapsed * 0.8) * (motion.matches ? 0 : 4), depth, size: p.size * perspective, light: Math.min(1, charge[i] + waveEnergy * 0.8) };
      });
      const aura = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, size * 1.25);
      aura.addColorStop(0, `rgba(100,195,240,${active ? 0.055 + energy * 0.025 : 0.025})`); aura.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = aura; ctx.fillRect(0, 0, width, height);
      edges.forEach(([a, b]) => {
        const p = projected[a], q = projected[b], light = Math.min(p.light, q.light);
        const front = Math.max(0.05, ((p.depth + q.depth) / 2 + 1) / 2);
        ctx.strokeStyle = `rgba(${light > 0.2 ? "144,222,255" : "136,180,204"},${0.07 + front * 0.26 + light * 0.48})`;
        ctx.lineWidth = 0.65 + light * 0.75; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      });
      if (!motion.matches) for (let i = sparks.length - 1; i >= 0; i--) {
        const spark = sparks[i]; spark.travel += dt * (active ? 2.7 : 1.2);
        const p = projected[spark.a], q = projected[spark.b];
        if (spark.travel >= 1) {
          charge[spark.b] = 1; sparks.splice(i, 1);
          if (spark.hops > 0 && sparks.length < 78) {
            const choices = neighbors[spark.b].filter(n => n !== spark.a);
            if (choices.length) sparks.push({ a: spark.b, b: choices[Math.floor(random() * choices.length)], travel: 0, hops: spark.hops - 1 });
          }
          continue;
        }
        const tail = Math.max(0, spark.travel - 0.3);
        ctx.strokeStyle = "rgba(165,229,255,0.65)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(p.x + (q.x - p.x) * tail, p.y + (q.y - p.y) * tail); ctx.lineTo(p.x + (q.x - p.x) * spark.travel, p.y + (q.y - p.y) * spark.travel); ctx.stroke();
        ctx.fillStyle = "#e0f6ff"; ctx.beginPath(); ctx.arc(p.x + (q.x - p.x) * spark.travel, p.y + (q.y - p.y) * spark.travel, 1.65, 0, Math.PI * 2); ctx.fill();
      }
      projected.forEach(p => {
        const front = Math.max(0.1, (p.depth + 1.1) / 2.2), light = motion.matches ? (active ? 0.4 : 0) : p.light;
        if (light > 0.15) {
          const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 8 + light * 5);
          halo.addColorStop(0, `rgba(114,209,255,${light * front * 0.55})`); halo.addColorStop(1, "rgba(100,200,255,0)");
          ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, 8 + light * 5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = `rgba(${light > 0.3 ? "224,249,255" : "166,208,230"},${Math.min(1, 0.15 + front * 0.7 + light * 0.5)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.4, p.size * (0.5 + front * 0.65) + light * 0.85), 0, Math.PI * 2); ctx.fill();
      });
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("pointermove", pointer); };
  }, [activity]);

  return <canvas ref={canvasRef} className="oracle-network-canvas" aria-hidden="true" />;
}
