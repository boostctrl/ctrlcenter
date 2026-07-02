"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Whether the home page is in layout-edit mode, and whether the visitor may
// enter it at all. `isAdmin` is decided server-side (app/page.tsx via
// isAdminSession) and only unlocks the editor UI — every save still goes
// through the session-gated settings API. The default value keeps consumers
// (FloatingNav renders on every page) working where no provider exists.
const EditModeContext = createContext<{
  isAdmin: boolean;
  editing: boolean;
  setEditing: (editing: boolean) => void;
}>({ isAdmin: false, editing: false, setEditing: () => {} });

export function useEditMode() {
  return useContext(EditModeContext);
}

export function EditModeProvider({
  isAdmin,
  initialEditing = false,
  children,
}: {
  isAdmin: boolean;
  initialEditing?: boolean;
  children: ReactNode;
}) {
  // initialEditing comes from the /?edit=1 deep link (admin Settings → Layout);
  // it's honored only for admins, so the link renders a plain page otherwise.
  const [editing, setEditing] = useState(isAdmin && initialEditing);
  return (
    <EditModeContext.Provider
      value={{ isAdmin, editing: isAdmin && editing, setEditing }}
    >
      {children}
    </EditModeContext.Provider>
  );
}
