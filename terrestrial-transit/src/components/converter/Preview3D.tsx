import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { FormatId } from '../../lib/formats';

interface Preview3DProps {
  file: File;
  format: FormatId;
}

export default function Preview3D({ file, format }: Preview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Setup scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfafafa);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);
    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(-5, -5, -5);
    scene.add(backLight);

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 20, 0xebebeb, 0xebebeb);
    scene.add(gridHelper);

    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };

    // Load file
    const loadModel = async () => {
      try {
        setLoading(true);
        setError(null);
        const buffer = await file.arrayBuffer();
        let object: THREE.Object3D | null = null;

        switch (format) {
          case 'stl': {
            const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
            const loader = new STLLoader();
            const geometry = loader.parse(buffer);
            const material = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.1, roughness: 0.6 });
            object = new THREE.Mesh(geometry, material);
            break;
          }
          case 'obj': {
            const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
            const loader = new OBJLoader();
            const text = new TextDecoder().decode(buffer);
            object = loader.parse(text);
            break;
          }
          case 'glb': {
            const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
            const loader = new GLTFLoader();
            object = await new Promise((resolve, reject) => {
              loader.parse(buffer, '', (gltf) => resolve(gltf.scene), reject);
            });
            break;
          }
          case '3mf': {
            const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
            const loader = new ThreeMFLoader();
            object = loader.parse(buffer);
            break;
          }
          case 'step':
          case 'iges': {
            setError('Preview not available for CAD files. Convert to a mesh format first.');
            setLoading(false);
            return;
          }
        }

        if (object) {
          object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              if (!child.material || (Array.isArray(child.material) && child.material.length === 0)) {
                child.material = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.1, roughness: 0.6 });
              }
            }
          });

          scene.add(object);

          const box = new THREE.Box3().setFromObject(object);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);

          object.position.sub(center);
          camera.position.set(maxDim * 1.5, maxDim * 1.0, maxDim * 1.5);
          camera.lookAt(0, 0, 0);
          controls.target.set(0, 0, 0);

          gridHelper.scale.setScalar(maxDim / 10);
        }

        setLoading(false);
      } catch (err: any) {
        setError(err?.message || 'Failed to load preview');
        setLoading(false);
      }
    };

    loadModel();
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [file, format]);

  return (
    <div className="relative w-full h-full min-h-[200px] rounded-md overflow-hidden bg-canvas-elevated border border-hairline">
      <div ref={containerRef} className="w-full h-full min-h-[200px]" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-canvas-elevated/80">
          <div className="flex items-center gap-2 text-[12px] text-mute font-mono">
            <span className="w-4 h-4 border-2 border-mute border-t-transparent rounded-full animate-spin" />
            Loading preview…
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-canvas-elevated/80">
          <p className="text-[12px] text-mute text-center px-4">{error}</p>
        </div>
      )}
      <div className="absolute bottom-2 right-2 text-[10px] text-faint font-mono">
        Drag to rotate · Scroll to zoom
      </div>
    </div>
  );
}
