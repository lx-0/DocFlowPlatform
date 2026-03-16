import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Documents from './pages/Documents'
import DocumentDetail from './pages/DocumentDetail'
import ApprovalQueue from './pages/ApprovalQueue'
import ApprovalReview from './pages/ApprovalReview'
import RoutingRulesAdmin from './pages/RoutingRulesAdmin'
import AdminUsers from './pages/AdminUsers'
import AdminRoles from './pages/AdminRoles'
import AdminAuditLogs from './pages/AdminAuditLogs'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/documents/:id" element={<DocumentDetail />} />
        <Route path="/approvals" element={<ApprovalQueue />} />
        <Route path="/approvals/:workflowId" element={<ApprovalReview />} />
        <Route path="/admin/routing-rules" element={<RoutingRulesAdmin />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/roles" element={<AdminRoles />} />
        <Route path="/admin/audit-logs" element={<AdminAuditLogs />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
