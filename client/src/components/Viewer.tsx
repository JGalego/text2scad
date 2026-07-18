import { Center, Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

function Model({ buffer }: { buffer: ArrayBuffer }) {
  const geometry = useMemo(() => {
    const loader = new STLLoader();
    const geom = loader.parse(buffer);
    // OpenSCAD models are authored Z-up (Z=0 is the ground plane); three.js
    // and OrbitControls assume Y-up. Without this, every model renders lying
    // on its side — easy to miss on a roughly-symmetric shape like a mug, but
    // obvious on anything with a clear "standing" orientation.
    geom.rotateX(-Math.PI / 2);
    geom.computeVertexNormals();
    return geom;
  }, [buffer]);

  return (
    <Center>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#4f8cff" roughness={0.35} metalness={0.05} />
      </mesh>
    </Center>
  );
}

export function Viewer({ buffer }: { buffer: ArrayBuffer | null }) {
  return (
    <Canvas
      shadows
      camera={{ position: [80, 80, 80], fov: 45 }}
      style={{ background: "radial-gradient(circle at 50% 30%, #1b2030, #0d0f16)" }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[60, 100, 40]} intensity={1.1} castShadow />
      <directionalLight position={[-60, 40, -40]} intensity={0.3} />
      {buffer && <Model buffer={buffer} />}
      <Grid
        args={[400, 400]}
        cellColor="#2a3040"
        sectionColor="#3a4358"
        fadeDistance={300}
        infiniteGrid
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </Canvas>
  );
}

export function makeStlDownloadUrl(buffer: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([buffer], { type: "model/stl" }));
}

export function scadBlobUrl(code: string): string {
  return URL.createObjectURL(new Blob([code], { type: "text/plain" }));
}
