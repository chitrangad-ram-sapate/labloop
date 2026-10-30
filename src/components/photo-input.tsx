"use client";

import { useState } from "react";

/** Picks or captures a photo, shrinks it to ≤1000 px JPEG in the browser, and submits it as a data URL. */
export function PhotoInput({ name = "photo", label = "Photo", required = false }: { name?: string; label?: string; required?: boolean }) {
  const [data, setData] = useState("");

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return setData("");
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
    const canvas = Object.assign(document.createElement("canvas"), { width: img.width * scale, height: img.height * scale });
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    setData(canvas.toDataURL("image/jpeg", 0.7));
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">
        {label}{required && " (required)"}
        <input type="file" accept="image/*" capture="environment" onChange={onChange} required={required && !data}
          className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5" />
      </label>
      <input type="hidden" name={name} value={data} />
      {data && <img src={data} alt="Selected photo preview" className="h-32 rounded-md border object-cover" />}
    </div>
  );
}
