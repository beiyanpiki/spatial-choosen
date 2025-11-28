import { Project } from "@/types/project";

const STORAGE_KEY = "spatial-web-projects";
const DB_NAME = "spatial-web";
const DB_VERSION = 2;
const IMAGE_STORE = "project-images";
const MATRIX_STORE = "project-matrix";

type ProjectMeta = Omit<Project, "imageData" | "matrixData">;

const isBrowser = () => typeof window !== "undefined";

const openDb = async () => new Promise<IDBDatabase>((resolve, reject) => {
  if (!isBrowser()) {
    reject(new Error("IndexedDB unavailable on server"));
    return;
  }
  const request = window.indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(IMAGE_STORE)) {
      db.createObjectStore(IMAGE_STORE);
    }
    if (!db.objectStoreNames.contains(MATRIX_STORE)) {
      db.createObjectStore(MATRIX_STORE);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const txDone = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

const readRawProjects = (): unknown[] => {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as unknown[];
  } catch (error) {
    console.error("Failed to parse projects", error);
    return [];
  }
};

const persistMetas = (metas: ProjectMeta[]) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(metas));
};

const saveImage = async (projectId: string, dataUrl: string) => {
  const db = await openDb();
  const tx = db.transaction(IMAGE_STORE, "readwrite");
  tx.objectStore(IMAGE_STORE).put(dataUrl, projectId);
  await txDone(tx);
};

const readImage = async (projectId: string): Promise<string | undefined> => {
  const db = await openDb();
  const tx = db.transaction(IMAGE_STORE, "readonly");
  const req = tx.objectStore(IMAGE_STORE).get(projectId);
  const value = await new Promise<string | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as string | undefined);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  return value ?? undefined;
};

const deleteImage = async (projectId: string) => {
  const db = await openDb();
  const tx = db.transaction(IMAGE_STORE, "readwrite");
  tx.objectStore(IMAGE_STORE).delete(projectId);
  await txDone(tx);
};

const saveMatrix = async (projectId: string, buffer: ArrayBuffer) => {
  const db = await openDb();
  const tx = db.transaction(MATRIX_STORE, "readwrite");
  tx.objectStore(MATRIX_STORE).put(buffer, projectId);
  await txDone(tx);
};

const readMatrix = async (projectId: string): Promise<ArrayBuffer | undefined> => {
  const db = await openDb();
  const tx = db.transaction(MATRIX_STORE, "readonly");
  const req = tx.objectStore(MATRIX_STORE).get(projectId);
  const value = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  return value ?? undefined;
};

const deleteMatrix = async (projectId: string) => {
  const db = await openDb();
  const tx = db.transaction(MATRIX_STORE, "readwrite");
  tx.objectStore(MATRIX_STORE).delete(projectId);
  await txDone(tx);
};

const migrateInline = async (raw: unknown[]): Promise<ProjectMeta[]> => {
  const metas: ProjectMeta[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { imageData, matrixData, ...rest } = entry as Project;
    void matrixData;
    const meta = rest as ProjectMeta;
    if (typeof imageData === "string") {
      try {
        await saveImage(meta.id, imageData);
      } catch (error) {
        console.error("Failed to move image to IndexedDB", error);
      }
    }
    metas.push(meta);
  }
  persistMetas(metas);
  return metas;
};

const readMetas = async (): Promise<ProjectMeta[]> => {
  const raw = readRawProjects();
  const hasInline = raw.some((p) => p && typeof p === "object" && "imageData" in (p as Record<string, unknown>));
  if (hasInline) return migrateInline(raw);
  return raw as ProjectMeta[];
};

export async function readProjects(): Promise<Project[]> {
  const metas = await readMetas();
  const projects: Project[] = [];
  for (const meta of metas) {
    const imageData = await readImage(meta.id);
    if (!imageData) continue;
    projects.push({ ...meta, imageData });
  }
  return projects;
}

export async function persistProjects(projects: Project[]) {
  const metas = projects.map(({ imageData, matrixData, ...rest }) => {
    void imageData;
    void matrixData;
    return rest;
  });
  persistMetas(metas);
  await Promise.all(projects.map(async (p) => {
    await saveImage(p.id, p.imageData);
    if (p.matrixData) {
      await saveMatrix(p.id, p.matrixData);
    }
  }));
}

export async function upsertProject(project: Project) {
  const metas = await readMetas();
  const { imageData, matrixData, ...meta } = project;
  const idx = metas.findIndex((p) => p.id === project.id);
  if (idx >= 0) {
    metas[idx] = meta;
  } else {
    metas.unshift(meta);
  }
  persistMetas(metas);
  await saveImage(project.id, imageData);
  if (matrixData) {
    await saveMatrix(project.id, matrixData);
  }
}

export async function getProject(projectId: string): Promise<Project | undefined> {
  const metas = await readMetas();
  const meta = metas.find((p) => p.id === projectId);
  if (!meta) return undefined;
  const [imageData, matrixData] = await Promise.all([
    readImage(projectId),
    readMatrix(projectId),
  ]);
  if (!imageData) return undefined;
  return { ...meta, imageData, matrixData } as Project;
}

export async function deleteProject(projectId: string) {
  const metas = await readMetas();
  persistMetas(metas.filter((p) => p.id !== projectId));
  await deleteImage(projectId);
  await deleteMatrix(projectId);
}
