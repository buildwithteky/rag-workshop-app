import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardShell } from "@/components/DashboardShell";
import { ChatInterface } from "@/components/ChatInterface";

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardShell>
        <ChatInterface />
      </DashboardShell>
    </ProtectedRoute>
  );
}
