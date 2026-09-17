import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import modelUrl from "../../../design/blender/exports/feedback-disc.glb?url";
import { artUrl } from "@/services/platform";

/** Loaded only when Disc mode is opened; playback stays owned by the player service. */
export default function DiscView({ art, playing, reducedMotion, fallback }: { art?: string | null; playing: boolean; reducedMotion: boolean; fallback: ReactNode }) {
  const host = useRef<HTMLSpanElement>(null);
  const label = useRef<{ material: THREE.MeshStandardMaterial; printed: THREE.Texture | null } | null>(null);
  const redraw = useRef<(() => void) | null>(null);
  const update = useRef<(() => void) | null>(null);
  const active = useRef(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  active.current = playing && !reducedMotion;
  useEffect(() => { update.current?.(); }, [playing, reducedMotion]);
  // The sleeve is printed onto the label ring — inked and ringed, not a cover pasted on a circle.
  const paint = useRef<(() => void) | null>(null);
  useEffect(() => {
    let texture: THREE.CanvasTexture | undefined;
    let image: HTMLImageElement | undefined;
    let cancelled = false;
    const print = (source: CanvasImageSource, width: number, height: number) => {
      const size = 1024;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const scale = Math.max(size / width, size / height);
      ctx.drawImage(source, (size - width * scale) / 2, (size - height * scale) / 2, width * scale, height * scale);
      // Screen-printed ink: slightly muted, with the lacquer ring pattern over it.
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(217, 212, 199, 0.22)";
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(11, 11, 11, 0.10)";
      ctx.lineWidth = 1;
      for (let r = size * 0.16; r < size * 0.5; r += 6) {
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      const sheen = ctx.createRadialGradient(size / 2, size / 2, size * 0.14, size / 2, size / 2, size * 0.5);
      sheen.addColorStop(0, "rgba(255, 255, 255, 0.10)");
      sheen.addColorStop(1, "rgba(0, 0, 0, 0.28)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, size, size);
      return canvas;
    };
    const apply = () => {
      const target = label.current;
      if (!target) return;
      const url = artUrl(art, 480);
      if (!url) { target.material.map = target.printed; target.material.needsUpdate = true; redraw.current?.(); return; }
      image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        if (cancelled || !label.current) return;
        const canvas = print(image!, image!.naturalWidth, image!.naturalHeight);
        if (!canvas) return;
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        // The label's planar UVs are mirrored, so any type in the sleeve would read backwards.
        texture.wrapS = THREE.RepeatWrapping;
        texture.center.set(.5, .5);
        texture.repeat.set(-1, 1);
        texture.rotation = Math.PI;
        label.current.material.map = texture;
        label.current.material.roughness = 0.42;
        label.current.material.needsUpdate = true;
        redraw.current?.();
      };
      image.onerror = () => { /* keep the printed label */ };
      image.src = url;
    };
    paint.current = apply;
    apply();
    return () => {
      cancelled = true;
      paint.current = null;
      if (image) { image.onload = null; image.onerror = null; }
      if (label.current && label.current.material.map === texture) { label.current.material.map = label.current.printed; label.current.material.needsUpdate = true; }
      texture?.dispose();
    };
  }, [art]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    element.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 20);
    camera.position.set(0, 0, 3.8);
    const stage = new THREE.Group(); scene.add(stage);
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(environment);
    scene.environment = env.texture;
    environment.dispose(); pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xd9d4c7, 0x3a3a3a, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(2, 3, 4); scene.add(light);
    let disposed = false;
    let model: THREE.Object3D | undefined;
    let previous = 0;
    const release = (root: THREE.Object3D) => root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
    const render = () => renderer.render(scene, camera);
    const sync = () => {
      renderer.setAnimationLoop(null);
      if (disposed || !model) return;
      render();
      if (active.current && !document.hidden) {
        previous = performance.now();
        renderer.setAnimationLoop((time) => { stage.rotation.z -= Math.min(time - previous, 100) * .00018; previous = time; render(); });
      }
    };
    update.current = sync;
    redraw.current = render;
    new GLTFLoader().load(modelUrl, (gltf) => {
      if (disposed) { release(gltf.scene); return; }
      model = gltf.scene;
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || !/label/i.test(object.name)) return;
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        if (material instanceof THREE.MeshStandardMaterial) label.current = { material, printed: material.map };
      });
      const disc = model.getObjectByName("FeedbackDisc");
      if (disc) { disc.position.set(0, 0, 0); disc.rotation.set(Math.PI / 2, 0, 0); }
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const scale = 2 / Math.max(size.x, size.y, size.z);
      stage.scale.setScalar(scale);
      stage.rotation.x = -0.46; // a disc held at an angle, not a flat circle
      stage.rotation.y = 0.16;
      stage.position.y = 0.05;
      stage.add(model);
      setReady(true); sync(); paint.current?.();
    }, undefined, () => { if (!disposed) setFailed(true); });
    const resize = new ResizeObserver(() => { const size = Math.max(1, element.clientWidth); renderer.setSize(size, size, false); render(); });
    resize.observe(element);
    const contextLost = (event: Event) => { event.preventDefault(); renderer.setAnimationLoop(null); setFailed(true); };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true; update.current = null; redraw.current = null; label.current = null; resize.disconnect();
      document.removeEventListener("visibilitychange", sync);
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      if (model) release(model);
      env.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, []);
  return <span style={{ display: "block", position: "relative", aspectRatio: "1" }}>
    {(!ready || failed) && fallback}
    <span ref={host} aria-hidden="true" style={{ position: "absolute", inset: 0, visibility: failed || !ready ? "hidden" : "visible" }} />
  </span>;
}
