import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardShell } from "@/components/DashboardShell";
import { ChatShell } from "@/components/ChatShell";

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardShell>
        <ChatShell />
      </DashboardShell>
    </ProtectedRoute>
  );
}
