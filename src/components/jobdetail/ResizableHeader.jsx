import React, { useState, useCallback, useRef, useEffect } from "react";

export default function ResizableHeader({ children, width, minWidth = 20, onResize, className = "" }) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startWidth.current = width;
    setDragging(true);
  }, [width]);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e) => {
      const delta = e.clientX - startX.current;
      const newWidth = Math.max(minWidth, startWidth.current + delta);
      onResize(newWidth);
    };

    const onMouseUp = () => {
      setDragging(false);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, minWidth, onResize]);

  return (
    <th
      className={`relative select-none ${className}`}
      style={{ width: width + "px", minWidth: minWidth + "px" }}
    >
      {children}
      <div
        onMouseDown={onMouseDown}
        className={`absolute top-0 right-0 w-[4px] h-full cursor-col-resize z-20 group
          ${dragging ? "bg-blue-500/60" : "hover:bg-blue-500/40"}`}
        style={{ touchAction: "none" }}
      />
    </th>
  );
}