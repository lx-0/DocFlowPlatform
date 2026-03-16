import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ApprovalQueue from './pages/ApprovalQueue'
import ApprovalReview from './pages/ApprovalReview'
import RoutingRulesAdmin from './pages/RoutingRulesAdmin'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/approvals" element={<ApprovalQueue />} />
        <Route path="/approvals/:workflowId" element={<ApprovalReview />} />
        <Route path="/admin/routing-rules" element={<RoutingRulesAdmin />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
