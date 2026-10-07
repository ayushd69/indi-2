import { useEffect, useState } from 'react'
import { Activity, AlertCircle, ArrowDownToLine, Bell, BookOpen, Boxes, Check, CircleHelp, Clock3, FileBarChart, LayoutDashboard, LifeBuoy, LogOut, Menu, Plus, Search, Send, Settings2, ShieldCheck, Trash2, Users, X } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from './api'

const navigation = [
    { id: 'Overview', icon: LayoutDashboard, roles: '*' },
    { id: 'Tickets', icon: LifeBuoy, roles: '*' },
    { id: 'Assets', icon: Boxes, roles: ['System Admin', 'IT Manager', 'Asset Manager', 'Employee'] },
    { id: 'Knowledge', icon: BookOpen, roles: '*' },
    { id: 'People', icon: Users, roles: ['System Admin'] },
    { id: 'Departments', icon: Settings2, roles: ['System Admin'] },
    { id: 'Categories', icon: Settings2, roles: ['System Admin'] },
    { id: 'SLA policies', icon: Clock3, roles: ['System Admin'] },
    { id: 'Reports', icon: FileBarChart, roles: ['System Admin', 'IT Manager', 'Asset Manager'] },
    { id: 'Work logs', icon: Clock3, roles: ['System Admin', 'IT Manager', 'Technician'] },
    { id: 'Audit trail', icon: ShieldCheck, roles: ['System Admin'] },
]
const colors = ['#137c70', '#d7952b', '#4a79a5', '#be6157', '#735e9d', '#85959d']
const apiPath = { Assets: 'assets', Knowledge: 'articles', People: 'users', Departments: 'departments', Categories: 'categories', 'SLA policies': 'slas', 'Work logs': 'worklogs', 'Audit trail': 'audit' }
const roleHome = { 'System Admin': 'Platform overview', 'IT Manager': 'Support overview', Technician: 'My queue', Employee: 'My requests', 'Asset Manager': 'Asset overview' }

function initials(name = '') {
    return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

function App() {
    const [user, setUser] = useState(null)
    const [page, setPage] = useState('Overview')
    const [tickets, setTickets] = useState([])
    const [assetRequests, setAssetRequests] = useState([])
    const [stats, setStats] = useState(null)
    const [items, setItems] = useState([])
    const [notifications, setNotifications] = useState([])
    const [query, setQuery] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [toast, setToast] = useState('')
    const [modal, setModal] = useState('')
    const [selected, setSelected] = useState(null)
    const [mobileNav, setMobileNav] = useState(false)

    useEffect(() => {
        const token = localStorage.getItem('servicedesk.token')
        if (!token) return
        api.get('/auth/me').then(({ data }) => setUser(data.user)).catch(() => localStorage.removeItem('servicedesk.token'))
    }, [])

    useEffect(() => {
        if (!user) return
        const requests = [api.get('/dashboard'), api.get('/tickets?limit=100')]
        if (page === 'Overview' && ['System Admin', 'IT Manager', 'Asset Manager'].includes(user.role)) requests.push(api.get('/reports/summary').catch(() => ({ data: null })))
        if (page === 'Notifications') requests.push(api.get('/notifications'))
        if (apiPath[page]) requests.push(api.get(`/${apiPath[page]}?limit=100`))
        const assetRequestsIndex = page === 'Assets' ? requests.length : -1
        if (page === 'Assets') requests.push(api.get('/asset-requests'))
        Promise.all(requests).then((responses) => {
            setStats(responses[0].data)
            setTickets(responses[1].data.items)
            const summary = responses.find((response) => response.data?.statuses)
            if (summary) setStats((value) => ({ ...value, summary: summary.data }))
            const resource = responses.find((response) => response.data?.items && response !== responses[1] && response !== responses[0])
            if (resource && (apiPath[page] || page === 'Notifications')) {
                if (page === 'Notifications') setNotifications(resource.data.items)
                else setItems(resource.data.items)
            }
            if (assetRequestsIndex >= 0) setAssetRequests(responses[assetRequestsIndex].data.items)
        }).catch((requestError) => setError(requestError.response?.data?.error?.message || 'Could not load this view. Check the API connection.'))
            .finally(() => setBusy(false))
    }, [user, page])

    useEffect(() => {
        if (!toast) return undefined
        const timer = window.setTimeout(() => setToast(''), 3200)
        return () => window.clearTimeout(timer)
    }, [toast])

    async function login(email, password) {
        setBusy(true)
        setError('')
        try {
            const { data } = await api.post('/auth/login', { email, password })
            localStorage.setItem('servicedesk.token', data.token)
            setUser(data.user)
            setPage('Overview')
        } catch (requestError) {
            setError(requestError.response?.data?.error?.message || 'Sign in failed')
        } finally { setBusy(false) }
    }

    function logout() {
        localStorage.removeItem('servicedesk.token')
        setUser(null)
        setTickets([])
        setPage('Overview')
    }

    async function createTicket(form) {
        try {
            await api.post('/tickets', form)
            setModal('')
            setToast('Request created')
            refreshTickets()
        } catch (requestError) { setError(requestError.response?.data?.error?.message || 'Could not create request') }
    }

    async function refreshTickets() {
        const [{ data: ticketData }, { data: dashboardData }] = await Promise.all([api.get('/tickets?limit=100'), api.get('/dashboard')])
        setTickets(ticketData.items)
        setStats(dashboardData)
        setSelected((current) => current ? ticketData.items.find((item) => item._id === current._id) || current : null)
    }

    async function changeStatus(ticket, status) {
        try {
            await api.patch(`/tickets/${ticket._id}/status`, { status })
            setToast(`${ticket.ticketId} moved to ${status}`)
            if (selected?._id === ticket._id) setSelected(null)
            refreshTickets()
        } catch (requestError) { setError(requestError.response?.data?.error?.message || 'Status update failed') }
    }

    async function createResource(form) {
        const collection = apiPath[page]
        try {
            const payload = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== '' && value !== null && value !== undefined))
            await api.post(`/${collection}`, payload)
            setError('')
            setModal('')
            setToast(`${page.slice(0, -1)} created`)
            const { data } = await api.get(`/${collection}?limit=100`)
            setItems(data.items)
        } catch (requestError) { setError(requestError.response?.data?.error?.message || 'Could not save record') }
    }

    async function deleteUser(item) {
        if (!window.confirm(`Delete ${item.name}'s account?`)) return
        try {
            await api.delete(`/users/${item._id}`)
            setItems((current) => current.filter((userItem) => userItem._id !== item._id))
            setToast(`${item.name}'s account deleted`)
        } catch (requestError) { setError(requestError.response?.data?.error?.message || 'Could not delete user') }
    }

    async function changeAssetLifecycle(item, status) {
        try {
            await api.patch(`/assets/${item._id}/lifecycle`, { status })
            const { data } = await api.get('/assets?limit=100')
            setItems(data.items)
            setToast(`${item.name} moved to ${status}`)
        } catch (requestError) { setError(requestError.response?.data?.error?.message || 'Asset update failed') }
    }

    async function refreshAssets() {
        const [{ data: assets }, { data: requests }] = await Promise.all([api.get('/assets?limit=100'), api.get('/asset-requests')])
        setItems(assets.items)
        setAssetRequests(requests.items)
    }

    async function requestAsset(form) {
        try {
            await api.post('/asset-requests', form)
            await refreshAssets()
            setToast('Temporary asset request sent to the Asset Manager')
            return true
        } catch (requestError) {
            setError(requestError.response?.data?.error?.message || 'Could not request this asset')
            return false
        }
    }

    async function reviewAssetRequest(request, decision) {
        const reason = decision === 'decline' ? window.prompt('Reason for declining this asset request (optional):') : ''
        if (reason === null) return
        try {
            await api.patch(`/asset-requests/${request._id}/decision`, { decision, reason })
            await refreshAssets()
            setToast(decision === 'approve' ? 'Asset approved and issued to the employee' : 'Asset request declined')
        } catch (requestError) {
            setError(requestError.response?.data?.error?.message || 'Could not review asset request')
        }
    }

    async function requestAssetReturn(request) {
        try {
            await api.patch(`/asset-requests/${request._id}/return`)
            await refreshAssets()
            setToast('Return request sent to the Asset Manager')
        } catch (requestError) {
            setError(requestError.response?.data?.error?.message || 'Could not request asset return')
        }
    }

    async function receiveAssetReturn(request) {
        try {
            await api.patch(`/asset-requests/${request._id}/receive`)
            await refreshAssets()
            setToast('Asset return received and item is available again')
        } catch (requestError) {
            setError(requestError.response?.data?.error?.message || 'Could not receive asset return')
        }
    }

    async function markAllRead() {
        await api.patch('/notifications/read-all')
        setNotifications((current) => current.map((item) => ({ ...item, readAt: new Date().toISOString() })))
        setToast('Notifications marked as read')
    }

    if (!user) return <LoginScreen onLogin={login} error={error} busy={busy} />

    const visibleNav = navigation.filter((item) => item.roles === '*' || item.roles.includes(user.role))
    const visibleTickets = tickets.filter((ticket) => `${ticket.ticketId} ${ticket.title} ${ticket.status} ${ticket.priority}`.toLowerCase().includes(query.toLowerCase()))
    const unread = notifications.filter((item) => !item.readAt).length

    return (
        <div className="min-h-screen bg-[#f5f7f7] text-[#202b33]">
            {mobileNav && <button className="fixed inset-0 z-30 bg-black/30 lg:hidden" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
            <aside className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col border-r border-[#e0e6e7] bg-white transition-transform lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="flex h-[72px] items-center gap-3 border-b border-[#edf0f0] px-5">
                    <div className="grid size-9 place-items-center rounded-md bg-[#137c70] text-sm font-semibold text-white">SD</div>
                    <div className="font-semibold">ServiceDesk <span className="text-[#137c70]">Pro</span><div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#8b989c]">Service operations</div></div>
                </div>
                <div className="px-4 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9aa5a8]">Workspace</div>
                <nav className="space-y-1 px-3">
                    {visibleNav.map(({ id, icon: Icon }) => <button key={id} onClick={() => { setPage(id); setQuery(''); setMobileNav(false) }} className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] font-medium transition ${page === id ? 'bg-[#e7f2f0] text-[#0d7267]' : 'text-[#59676c] hover:bg-[#f4f7f7]'}`}><Icon size={17} strokeWidth={1.8} />{id}{id === 'Notifications' && unread > 0 && <span className="ml-auto rounded-full bg-[#d8554d] px-1.5 py-0.5 text-[10px] text-white">{unread}</span>}</button>)}
                    <button onClick={() => setPage('Notifications')} className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] font-medium ${page === 'Notifications' ? 'bg-[#e7f2f0] text-[#0d7267]' : 'text-[#59676c] hover:bg-[#f4f7f7]'}`}><Bell size={17} strokeWidth={1.8} />Notifications{unread > 0 && <span className="ml-auto rounded-full bg-[#d8554d] px-1.5 py-0.5 text-[10px] text-white">{unread}</span>}</button>
                </nav>
                <div className="mt-auto border-t border-[#edf0f0] p-3">
                    <div className="mb-2 flex items-center gap-3 rounded-md px-2 py-2"><div className="grid size-9 place-items-center rounded-full bg-[#e8efee] text-xs font-semibold text-[#137c70]">{initials(user.name)}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{user.name}</div><div className="truncate text-[11px] text-[#7e8b8e]">{user.role}</div></div></div>
                    <button onClick={logout} className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-xs text-[#667579] hover:bg-[#f4f7f7]"><LogOut size={15} />Sign out</button>
                </div>
            </aside>

            <div className="min-h-screen lg:pl-[252px]">
                <header className="sticky top-0 z-20 flex h-[72px] items-center gap-4 border-b border-[#e0e6e7] bg-white/95 px-5 backdrop-blur sm:px-8">
                    <button className="rounded-md p-2 text-[#5c6b70] hover:bg-[#f3f6f6] lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button>
                    <div className="hidden text-[12px] text-[#91a0a4] sm:block">Workspace <span className="px-2 text-[#bdc6c7]">/</span><span className="font-medium text-[#344249]">{page}</span></div>
                    <div className="ml-auto flex items-center gap-2 sm:gap-4">
                        <label className="hidden h-9 w-64 items-center gap-2 rounded-md border border-[#e2e7e8] px-3 text-[#849195] md:flex"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this view" className="w-full bg-transparent text-xs text-[#344249] outline-none placeholder:text-[#9ca8aa]" /></label>
                        <button onClick={() => setPage('Notifications')} aria-label="Notifications" className="relative rounded-md p-2 text-[#647277] hover:bg-[#f3f6f6]"><Bell size={18} />{unread > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-[#d8554d] ring-2 ring-white" />}</button>
                        <div className="hidden h-8 w-px bg-[#e5e9e9] sm:block" />
                        <button onClick={() => setPage('Profile')} className="grid size-8 place-items-center rounded-full bg-[#e8efee] text-[10px] font-semibold text-[#137c70]" title="Profile">{initials(user.name)}</button>
                    </div>
                </header>

                <main className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8">
                    {error && <div className="mb-5 flex items-center gap-2 rounded-md border border-[#f0d2cf] bg-[#fff8f7] px-4 py-3 text-sm text-[#a4443d]"><AlertCircle size={16} />{error}<button className="ml-auto" onClick={() => setError('')} aria-label="Dismiss"><X size={15} /></button></div>}
                    {page === 'Overview' && <Dashboard user={user} stats={stats} tickets={tickets} busy={busy} onCreate={user.role === 'Employee' ? () => setModal('ticket') : null} onSelect={setSelected} onNavigate={setPage} />}
                    {page === 'Tickets' && <TicketsView tickets={visibleTickets} busy={busy} onCreate={user.role === 'Employee' ? () => setModal('ticket') : null} onSelect={setSelected} />}
                    {page === 'Assets' && <AssetsView user={user} items={items.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()))} requests={assetRequests} tickets={tickets} busy={busy} onCreate={() => setModal('resource')} onRequest={requestAsset} onDecision={reviewAssetRequest} onReturn={requestAssetReturn} onReceive={receiveAssetReturn} onLifecycle={changeAssetLifecycle} />}
                    {apiPath[page] && page !== 'Assets' && <ResourceView title={page} items={items.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()))} busy={busy} onCreate={() => setModal('resource')} allowUserCreate={user.role === 'System Admin'} canDeleteUsers={user.role === 'System Admin'} onUserDelete={deleteUser} />}
                    {page === 'Notifications' && <NotificationsView items={notifications} onReadAll={markAllRead} />}
                    {page === 'Reports' && <ReportsView tickets={tickets} stats={stats} />}
                    {page === 'Profile' && <ProfileView user={user} />}
                </main>
            </div>

            {modal === 'ticket' && <TicketModal onClose={() => setModal('')} onSubmit={createTicket} />}
            {modal === 'resource' && <ResourceModal title={page} onClose={() => setModal('')} onSubmit={createResource} />}
            {selected && <TicketPanel ticket={selected} user={user} onClose={() => setSelected(null)} onStatus={changeStatus} onUpdated={refreshTickets} onToast={setToast} />}
            {toast && <div role="status" className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-md bg-[#263a3b] px-4 py-3 text-sm text-white shadow-xl"><Check size={16} className="text-[#7ed0ba]" />{toast}</div>}
        </div>
    )
}

function LoginScreen({ onLogin, error, busy }) {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    return <div className="grid min-h-screen bg-[#f3f6f5] lg:grid-cols-[1.12fr_0.88fr]">
        <section className="relative hidden overflow-hidden bg-[#123d3b] px-14 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
            <div className="absolute -right-36 -top-24 size-[520px] rounded-full border border-white/10" /><div className="absolute -right-16 -top-4 size-[360px] rounded-full border border-white/10" />
            <div className="relative flex items-center gap-3"><div className="grid size-10 place-items-center rounded-md bg-[#5bb8a4] font-semibold">SD</div><span className="font-semibold">ServiceDesk Pro</span></div>
            <div className="relative max-w-xl pb-12"><p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-[#82cbbb]">IT service management</p><h1 className="text-5xl font-semibold leading-[1.1]">Support that keeps your team moving.</h1><p className="mt-5 max-w-md text-sm leading-6 text-[#c2d4d1]">One place for service requests, incident response and the assets your people rely on.</p><div className="mt-10 flex gap-7 text-xs text-[#c2d4d1]"><span className="flex items-center gap-2"><Activity size={15} />Live service operations</span><span className="flex items-center gap-2"><ShieldCheck size={15} />Role-aware access</span></div></div>
            <div className="relative text-[11px] text-[#9ab6b1]">ServiceDesk Pro · Secure workspace</div>
        </section>
        <section className="flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-[390px]">
                <div className="mb-9 flex items-center gap-3 lg:hidden"><span className="grid size-9 place-items-center rounded-md bg-[#137c70] text-xs font-semibold text-white">SD</span><span className="font-semibold">ServiceDesk Pro</span></div>
                <div className="mb-8"><div className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-[#137c70]">Welcome back</div><h2 className="text-[28px] font-semibold tracking-normal text-[#202b33]">Sign in to your workspace</h2><p className="mt-2 text-sm text-[#718086]">Use your work account to continue.</p></div>
                <form onSubmit={(event) => { event.preventDefault(); onLogin(email, password) }} className="space-y-5">
                    <label className="block text-xs font-semibold text-[#425158]">Work email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-[#d9e0e1] bg-white px-3 text-sm font-normal outline-none focus:border-[#168477] focus:ring-2 focus:ring-[#168477]/10" /></label>
                    <label className="block text-xs font-semibold text-[#425158]">Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-[#d9e0e1] bg-white px-3 text-sm font-normal outline-none focus:border-[#168477] focus:ring-2 focus:ring-[#168477]/10" /></label>
                    {error && <p className="rounded-md bg-[#fff1ef] px-3 py-2 text-xs text-[#a4443d]">{error}</p>}
                    <button disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#137c70] text-sm font-semibold text-white hover:bg-[#0d6d62] disabled:opacity-60">{busy ? 'Signing in…' : 'Sign in'}<Send size={15} /></button>
                </form>
            </div>
        </section>
    </div>
}

function PageHeading({ eyebrow, title, description, action }) {
    return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-[#188477]">{eyebrow}</div><h1 className="text-[25px] font-semibold tracking-normal text-[#26343a]">{title}</h1>{description && <p className="mt-1.5 text-sm text-[#758287]">{description}</p>}</div>{action}</div>
}

function ActionButton({ onClick, children, secondary = false }) {
    return <button onClick={onClick} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold ${secondary ? 'border border-[#dbe2e2] bg-white text-[#425158] hover:bg-[#f7f9f9]' : 'bg-[#137c70] text-white hover:bg-[#0d6d62]'}`}>{children}</button>
}

function Dashboard({ user, stats, tickets, busy, onCreate, onSelect, onNavigate }) {
    const statusData = stats?.ticketCounts?.map(({ _id, count }) => ({ name: _id, count })) || []
    const priorityData = stats?.priorityCounts?.map(({ _id, count }) => ({ name: _id, value: count })) || []
    const latest = tickets.slice(0, 5)
    const statusSummary = {
        'System Admin': ['Organization-wide status distribution', 'All service desk requests'],
        'IT Manager': ['Department status distribution', 'Requests in your department'],
        Technician: ['My work status', 'Requests assigned to you'],
        Employee: ['My request status', 'Updates on your requests'],
        'Asset Manager': ['Service desk status', 'Requests across the organization'],
    }[user.role] || ['Request status', 'Current workload']
    const metricLabels = {
        'System Admin': ['All requests', 'Open requests', 'Assets', 'Active users'],
        'IT Manager': ['Department requests', 'Need attention', 'Assets', 'Unread alerts'],
        Technician: ['My assigned requests', 'Need attention', 'Assets tracked', 'Unread alerts'],
        Employee: ['My requests', 'Need attention', 'My assets', 'Unread alerts'],
        'Asset Manager': ['Service requests', 'Need attention', 'Assets', 'Unread alerts'],
    }[user.role] || ['Total requests', 'Open requests', 'Assets', 'Unread alerts']
    const ticketScopeNote = {
        'System Admin': 'Across the organization',
        'IT Manager': 'In your department',
        Technician: 'Assigned to you',
        Employee: 'Submitted by you',
        'Asset Manager': 'Across the organization',
    }[user.role] || 'Across your access scope'
    return <>
        <PageHeading eyebrow={user.department?.name || user.role} title={roleHome[user.role] || 'Workspace overview'} description={`Good day, ${user.name.split(' ')[0]}. Here is the current service desk activity.`} action={onCreate && <ActionButton onClick={onCreate}><Plus size={15} />New request</ActionButton>} />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label={metricLabels[0]} value={stats?.totalTickets ?? '—'} icon={LifeBuoy} note={ticketScopeNote} />
            <StatCard label={metricLabels[1]} value={stats?.openTickets ?? '—'} icon={Activity} note="Needs attention" accent="#d7952b" />
            <StatCard label={metricLabels[2]} value={stats?.assets ?? '—'} icon={Boxes} note={user.role === 'Employee' ? 'Assigned to you' : 'Tracked inventory'} accent="#4a79a5" />
            <StatCard label={metricLabels[3]} value={user.role === 'System Admin' ? stats?.userCount ?? '—' : stats?.unreadNotifications ?? '—'} icon={Bell} note={user.role === 'System Admin' ? 'Enabled accounts' : 'Live from the service'} accent="#735e9d" />
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
            <section className="rounded-md border border-[#e0e6e7] bg-white p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-sm font-semibold">{statusSummary[0]}</h2><p className="mt-1 text-xs text-[#89969a]">{statusSummary[1]}</p></div><span className="rounded bg-[#f1f5f4] px-2 py-1 text-[10px] text-[#72817f]">Live</span></div><div className="h-[220px]">{statusData.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={statusData} margin={{ left: -18, right: 8, top: 8 }}><CartesianGrid vertical={false} stroke="#edf0f0" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#829094' }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#829094' }} allowDecimals={false} /><Tooltip cursor={{ fill: '#f6f8f8' }} /><Bar dataKey="count" fill="#168477" radius={[3, 3, 0, 0]} maxBarSize={38} /></BarChart></ResponsiveContainer> : <Empty message={busy ? 'Loading ticket activity…' : 'New requests will appear here.'} />}</div></section>
            <section className="rounded-md border border-[#e0e6e7] bg-white p-5"><div className="mb-3"><h2 className="text-sm font-semibold">Priority mix</h2><p className="mt-1 text-xs text-[#89969a]">Requests by urgency</p></div><div className="h-[190px]">{priorityData.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={priorityData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={79} paddingAngle={3}>{priorityData.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer> : <Empty message="Priority data will show here." />}</div><div className="flex flex-wrap justify-center gap-x-4 gap-y-2">{priorityData.map((item, index) => <span key={item.name} className="flex items-center gap-1.5 text-[10px] text-[#68777c]"><i className="size-2 rounded-full" style={{ background: colors[index % colors.length] }} />{item.name}</span>)}</div></section>
        </div>
        <section className="mt-5 rounded-md border border-[#e0e6e7] bg-white"><div className="flex items-center justify-between border-b border-[#edf0f0] px-5 py-4"><div><h2 className="text-sm font-semibold">Recent requests</h2><p className="mt-1 text-xs text-[#89969a]">Latest updates from your service desk</p></div><button className="text-xs font-semibold text-[#137c70] hover:underline" onClick={() => onNavigate('Tickets')}>View all</button></div><TicketTable tickets={latest} onSelect={onSelect} /></section>
    </>
}

function StatCard({ label, value, icon: Icon, note, accent = '#137c70' }) {
    return <section className="rounded-md border border-[#e0e6e7] bg-white p-4 sm:p-5"><div className="flex items-start justify-between"><span className="text-xs font-medium text-[#78868a]">{label}</span><span className="grid size-8 place-items-center rounded bg-[#f2f6f5]" style={{ color: accent }}><Icon size={16} /></span></div><div className="mt-4 text-[26px] font-semibold leading-none tracking-normal text-[#26343a]">{value}</div><div className="mt-2 text-[10px] text-[#94a0a3]">{note}</div></section>
}

function TicketsView({ tickets, busy, onCreate, onSelect }) {
    const [status, setStatus] = useState('All statuses')
    const filtered = status === 'All statuses' ? tickets : tickets.filter((ticket) => ticket.status === status)
    return <><PageHeading eyebrow="Service desk" title="Tickets" description="Track requests, resolve incidents and keep work moving." action={onCreate && <ActionButton onClick={onCreate}><Plus size={15} />Create ticket</ActionButton>} />
        <div className="mb-4 flex flex-wrap items-center gap-2"><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-[#dce3e3] bg-white px-3 text-xs text-[#59686c] outline-none"><option>All statuses</option>{['Open', 'Assigned', 'In Progress', 'Pending', 'Escalated', 'Resolved', 'Closed', 'Reopened'].map((item) => <option key={item}>{item}</option>)}</select><span className="text-xs text-[#89969a]">{filtered.length} requests</span></div>
        <section className="overflow-hidden rounded-md border border-[#e0e6e7] bg-white"><TicketTable tickets={filtered} busy={busy} onSelect={onSelect} /></section></>
}

function TicketTable({ tickets, busy, onSelect }) {
    if (busy && !tickets.length) return <div className="p-10"><Empty message="Loading requests…" /></div>
    if (!tickets.length) return <div className="p-12"><Empty message="No requests yet. Create a ticket to get support started." /></div>
    return <div className="overflow-x-auto"><table className="w-full min-w-[790px] text-left"><thead className="bg-[#f8f9f9] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#879498]"><tr><th className="px-5 py-3">Ticket</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Requester</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Assigned to</th><th className="px-5 py-3">Updated</th></tr></thead><tbody className="divide-y divide-[#edf0f0]">{tickets.map((ticket) => <tr key={ticket._id} onClick={() => onSelect(ticket)} className="cursor-pointer hover:bg-[#fafcfc]"><td className="whitespace-nowrap px-5 py-3.5 text-xs font-semibold text-[#137c70]">{ticket.ticketId}</td><td className="max-w-[280px] truncate px-4 py-3.5 text-xs font-medium text-[#38474d]">{ticket.title}</td><td className="px-4 py-3.5 text-xs text-[#6f7d81]">{ticket.employee?.name || '—'}</td><td className="px-4 py-3.5"><Badge value={ticket.priority} /></td><td className="px-4 py-3.5"><Badge value={ticket.status} /></td><td className="px-4 py-3.5 text-xs text-[#6f7d81]">{ticket.assignedTo?.name || 'Unassigned'}</td><td className="whitespace-nowrap px-5 py-3.5 text-xs text-[#89969a]">{new Date(ticket.updatedAt || ticket.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div>
}

function Badge({ value }) {
    const styles = { Critical: 'bg-[#fff0ee] text-[#b4453c]', High: 'bg-[#fff5e8] text-[#a86814]', Medium: 'bg-[#f3f5e8] text-[#7d7a2f]', Low: 'bg-[#eef5f2] text-[#438068]', Open: 'bg-[#eff4f7] text-[#567890]', Assigned: 'bg-[#edf3fa] text-[#4d7397]', 'In Progress': 'bg-[#edf5f3] text-[#317c70]', Pending: 'bg-[#fff6e9] text-[#9a741f]', Escalated: 'bg-[#fff0ee] text-[#b4453c]', Resolved: 'bg-[#eaf5ef] text-[#438068]', Closed: 'bg-[#f0f2f2] text-[#677579]', Reopened: 'bg-[#f3eff8] text-[#765f99]' }
    return <span className={`inline-flex whitespace-nowrap rounded px-2 py-1 text-[10px] font-semibold ${styles[value] || 'bg-[#f0f3f3] text-[#657478]'}`}>{value}</span>
}

function Empty({ message }) { return <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center text-xs text-[#89969a]"><CircleHelp size={19} strokeWidth={1.5} />{message}</div> }

function ResourceView({ title, items, busy, onCreate, allowUserCreate, canDeleteUsers, onUserDelete, canManageAssets, onAssetLifecycle }) {
    const fields = items.length ? Object.keys(items[0]).filter((key) => !['_id', '__v', 'history', 'passwordHash', 'updatedAt', 'createdAt'].includes(key)).slice(0, 6) : []
    const canCreate = ['Assets', 'Knowledge', 'Departments', 'Categories', 'SLA policies'].includes(title) || (title === 'People' && allowUserCreate)
    return <><PageHeading eyebrow="Service management" title={title} description={`Manage ${title.toLowerCase()} in your organization.`} action={canCreate && <ActionButton onClick={onCreate}><Plus size={15} />Add {title === 'Knowledge' ? 'article' : title === 'SLA policies' ? 'policy' : title === 'People' ? 'user' : title.slice(0, -1)}</ActionButton>} />
        <section className="overflow-hidden rounded-md border border-[#e0e6e7] bg-white">{busy && !items.length ? <div className="p-10"><Empty message="Loading records…" /></div> : !items.length ? <div className="p-12"><Empty message={`No ${title.toLowerCase()} found.`} /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="bg-[#f8f9f9] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#879498]"><tr>{fields.map((field) => <th key={field} className="px-5 py-3">{field.replace(/([A-Z])/g, ' $1')}</th>)}{title === 'Assets' && canManageAssets && <th className="px-5 py-3">Lifecycle</th>}{title === 'People' && canDeleteUsers && <th className="px-5 py-3">Actions</th>}</tr></thead><tbody className="divide-y divide-[#edf0f0]">{items.map((item) => <tr key={item._id}>{fields.map((field) => <td key={field} className="max-w-[260px] truncate px-5 py-3.5 text-xs text-[#526167]">{typeof item[field] === 'object' ? item[field]?.name || JSON.stringify(item[field]) : String(item[field] ?? '—')}</td>)}{title === 'Assets' && canManageAssets && <td className="px-5 py-2"><select aria-label={`Change ${item.name} lifecycle`} value={item.status || 'Available'} onChange={(event) => onAssetLifecycle(item, event.target.value)} className="h-8 rounded border border-[#dce3e3] bg-white px-2 text-[11px] text-[#536267]">{['Available', 'Under Repair', 'Lost', 'Damaged', 'Retired'].map((status) => <option key={status}>{status}</option>)}</select></td>}{title === 'People' && canDeleteUsers && <td className="px-5 py-2"><button type="button" disabled={item.role === 'System Admin'} title={item.role === 'System Admin' ? 'The sole System Admin account cannot be deleted' : `Delete ${item.name}`} aria-label={`Delete ${item.name}`} onClick={() => onUserDelete(item)} className="grid size-8 place-items-center rounded text-[#a4443d] hover:bg-[#fff1ef] disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={15} /></button></td>}</tr>)}</tbody></table></div>}</section></>
}

function AssetsView({ user, items, requests, tickets, busy, onCreate, onRequest, onDecision, onReturn, onReceive, onLifecycle }) {
    const [requesting, setRequesting] = useState(null)
    const [reason, setReason] = useState('')
    const [ticketId, setTicketId] = useState('')
    const employee = user.role === 'Employee'
    const assetManager = ['Asset Manager', 'System Admin'].includes(user.role)
    const managerView = assetManager || user.role === 'IT Manager'
    const canRequest = employee
    const availableAssets = items.filter((asset) => asset.status === 'Available')
    const activeRequests = requests.filter((request) => ['Approved', 'Return Requested'].includes(request.status))
    const openRequests = requests.filter((request) => ['Pending', 'Return Requested'].includes(request.status))
    const assignDates = (assetId) => activeRequests.find((request) => request.asset?._id === assetId)
    const availableTickets = tickets.filter((ticket) => !['Resolved', 'Closed'].includes(ticket.status))

    async function submitRequest(event) {
        event.preventDefault()
        const success = await onRequest({ asset: requesting._id, reason, ...(ticketId ? { ticket: ticketId } : {}) })
        if (success) {
            setRequesting(null)
            setReason('')
            setTicketId('')
        }
    }

    return <>
        <PageHeading
            eyebrow="Service management"
            title={employee ? 'Assets & temporary equipment' : 'Assets'}
            description={employee
                ? 'Check available equipment and request a temporary replacement while your own device is being repaired.'
                : assetManager
                    ? 'Review temporary equipment requests, track checkouts and confirm returned items.'
                    : 'View available assets and equipment assigned to employees in your department.'}
            action={assetManager && <ActionButton onClick={onCreate}><Plus size={15} />Add Asset</ActionButton>}
        />

        {employee && <section className="mb-6 rounded-md border border-[#e0e6e7] bg-white p-4 text-xs leading-5 text-[#68777c]">
            <strong className="text-[#344249]">Need a temporary replacement?</strong> Create a support ticket for your faulty device, choose an available item below, and explain what you need it for. The Asset Manager will review the request and record issue and return times.
        </section>}

        {assetManager && openRequests.length > 0 && <section className="mb-6 rounded-md border border-[#e0e6e7] bg-white">
            <div className="border-b border-[#edf0f0] px-5 py-4"><h2 className="text-sm font-semibold">Requests needing action</h2><p className="mt-1 text-xs text-[#89969a]">Approve or decline requests; confirm physical returns before an item becomes available again.</p></div>
            <div className="divide-y divide-[#edf0f0]">
                {openRequests.map((request) => <article key={request._id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                    <div className="min-w-[220px] flex-1">
                        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{request.asset?.name || 'Asset'}</span><Badge value={request.status} /></div>
                        <p className="mt-1 text-xs text-[#59676c]">{request.employee?.name || 'Employee'} · {request.asset?.assetId || 'No asset ID'} · {request.asset?.type || 'Equipment'}</p>
                        <p className="mt-2 text-xs leading-5 text-[#728084]">Reason: {request.reason}</p>
                        {request.ticket && <p className="mt-1 text-[11px] text-[#137c70]">Related ticket {request.ticket.ticketId}: {request.ticket.title}</p>}
                        <p className="mt-1 text-[10px] text-[#9aa5a8]">Requested {new Date(request.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex gap-2">
                        {request.status === 'Pending' && <>
                            <button type="button" onClick={() => onDecision(request, 'approve')} className="h-8 rounded bg-[#137c70] px-3 text-xs font-semibold text-white">Approve & issue</button>
                            <button type="button" onClick={() => onDecision(request, 'decline')} className="h-8 rounded border border-[#dfe6e6] px-3 text-xs font-semibold text-[#536267]">Decline</button>
                        </>}
                        {request.status === 'Return Requested' && <button type="button" onClick={() => onReceive(request)} className="h-8 rounded bg-[#137c70] px-3 text-xs font-semibold text-white">Confirm item received</button>}
                    </div>
                </article>)}
            </div>
        </section>}

        {managerView && requests.length > 0 && <section className="mb-6 overflow-hidden rounded-md border border-[#e0e6e7] bg-white">
            <div className="border-b border-[#edf0f0] px-5 py-4"><h2 className="text-sm font-semibold">Loan and request history</h2><p className="mt-1 text-xs text-[#89969a]">A record of who requested, received, and returned each temporary asset{user.role === 'IT Manager' ? ' in your department' : ''}.</p></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left">
                <thead className="bg-[#f8f9f9] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#879498]"><tr><th className="px-5 py-3">Asset</th><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Requested</th><th className="px-4 py-3">Issued</th><th className="px-5 py-3">Received back</th></tr></thead>
                <tbody className="divide-y divide-[#edf0f0]">{requests.map((request) => <tr key={request._id}>
                    <td className="px-5 py-3.5 text-xs font-medium text-[#38474d]">{request.asset?.name || 'Asset'}<div className="mt-1 text-[10px] text-[#89969a]">{request.asset?.assetId || 'No asset ID'}</div></td>
                    <td className="px-4 py-3.5 text-xs text-[#526167]">{request.employee?.name || 'Employee'}</td>
                    <td className="px-4 py-3.5"><Badge value={request.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-[10px] text-[#89969a]">{new Date(request.createdAt).toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-[10px] text-[#89969a]">{request.issuedAt ? new Date(request.issuedAt).toLocaleString() : '—'}</td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-[10px] text-[#89969a]">{request.returnedAt ? new Date(request.returnedAt).toLocaleString() : '—'}</td>
                </tr>)}</tbody>
            </table></div>
        </section>}

        {employee && requests.length > 0 && <section className="mb-6 overflow-hidden rounded-md border border-[#e0e6e7] bg-white">
            <div className="border-b border-[#edf0f0] px-5 py-4"><h2 className="text-sm font-semibold">My temporary asset requests</h2><p className="mt-1 text-xs text-[#89969a]">Issue and return times are recorded for each approved loan.</p></div>
            <div className="divide-y divide-[#edf0f0]">
                {requests.map((request) => <article key={request._id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                    <div>
                        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{request.asset?.name || 'Asset'}</span><Badge value={request.status} /></div>
                        <p className="mt-1 text-xs text-[#68777c]">{request.asset?.assetId || 'No asset ID'} · {request.reason}</p>
                        {request.ticket && <p className="mt-1 text-[11px] text-[#137c70]">Related ticket {request.ticket.ticketId}: {request.ticket.title}</p>}
                        {request.declineReason && <p className="mt-1 text-[11px] text-[#a4443d]">Manager note: {request.declineReason}</p>}
                        {request.issuedAt && <p className="mt-1 text-[10px] text-[#89969a]">Issued: {new Date(request.issuedAt).toLocaleString()}</p>}
                        {request.returnedAt && <p className="mt-1 text-[10px] text-[#89969a]">Received back: {new Date(request.returnedAt).toLocaleString()}</p>}
                    </div>
                    {request.status === 'Approved' && <button type="button" onClick={() => onReturn(request)} className="h-8 rounded border border-[#dfe6e6] px-3 text-xs font-semibold text-[#536267]">Request return</button>}
                    {request.status === 'Return Requested' && <span className="text-xs text-[#89969a]">Waiting for Asset Manager to confirm receipt</span>}
                </article>)}
            </div>
        </section>}

        <section className="overflow-hidden rounded-md border border-[#e0e6e7] bg-white">
            <div className="border-b border-[#edf0f0] px-5 py-4"><h2 className="text-sm font-semibold">{employee ? 'Available equipment' : 'Asset inventory'}</h2><p className="mt-1 text-xs text-[#89969a]">{employee ? `${availableAssets.length} items currently available to request` : 'Current assignees and issue times are shown for temporary loans.'}</p></div>
            {busy && !items.length ? <div className="p-10"><Empty message="Loading assets…" /></div> : !items.length ? <div className="p-12"><Empty message="No assets found." /></div> : <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left">
                    <thead className="bg-[#f8f9f9] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#879498]"><tr>
                        <th className="px-5 py-3">Asset ID</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Brand / Type</th><th className="px-4 py-3">Status</th>
                        {!employee && <><th className="px-4 py-3">Assigned employee</th><th className="px-4 py-3">Issued</th></>}
                        {canRequest && <th className="px-5 py-3">Request</th>}
                        {assetManager && <th className="px-5 py-3">Lifecycle</th>}
                    </tr></thead>
                    <tbody className="divide-y divide-[#edf0f0]">{items.map((asset) => {
                        const loan = assignDates(asset._id)
                        return <tr key={asset._id}>
                            <td className="whitespace-nowrap px-5 py-3.5 text-xs font-semibold text-[#137c70]">{asset.assetId || '—'}</td>
                            <td className="px-4 py-3.5 text-xs font-medium text-[#38474d]">{asset.name}</td>
                            <td className="px-4 py-3.5 text-xs text-[#6f7d81]">{[asset.brand, asset.type].filter(Boolean).join(' · ') || '—'}</td>
                            <td className="px-4 py-3.5"><Badge value={asset.status || 'Available'} /></td>
                            {!employee && <>
                                <td className="px-4 py-3.5 text-xs text-[#6f7d81]">{asset.employee?.name || '—'}</td>
                                <td className="whitespace-nowrap px-4 py-3.5 text-xs text-[#89969a]">{loan?.issuedAt ? new Date(loan.issuedAt).toLocaleString() : '—'}</td>
                            </>}
                            {canRequest && <td className="px-5 py-3.5">{asset.status === 'Available' ? <button type="button" onClick={() => setRequesting(asset)} className="h-8 rounded bg-[#137c70] px-3 text-xs font-semibold text-white">Request temporary item</button> : <span className="text-xs text-[#89969a]">Not available</span>}</td>}
                            {assetManager && <td className="px-5 py-3.5">{['Requested', 'Assigned'].includes(asset.status) ? <span className="text-xs text-[#89969a]">{asset.status === 'Requested' ? 'Approval pending' : 'Managed by loan / return'}</span> : <select aria-label={`Change ${asset.name} lifecycle`} value={asset.status || 'Available'} onChange={(event) => onLifecycle(asset, event.target.value)} className="h-8 rounded border border-[#dce3e3] bg-white px-2 text-[11px] text-[#536267]">{['Available', 'Under Repair', 'Lost', 'Damaged', 'Retired'].map((status) => <option key={status}>{status}</option>)}</select>}</td>}
                        </tr>
                    })}</tbody>
                </table>
            </div>}
        </section>

        {requesting && <ModalFrame title={`Request ${requesting.name}`} onClose={() => setRequesting(null)}>
            <form onSubmit={submitRequest} className="space-y-4">
                <p className="text-xs leading-5 text-[#68777c]">This item is currently available. Explain why you need a temporary replacement; the Asset Manager will approve or decline it.</p>
                <Field label="Reason"><textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} maxLength={1000} rows={4} placeholder="For example: my laptop is under repair and I need a temporary laptop to continue working." className="input resize-y" /></Field>
                <Field label="Related support ticket (optional)"><select value={ticketId} onChange={(event) => setTicketId(event.target.value)} className="input"><option value="">No related ticket</option>{availableTickets.map((ticket) => <option key={ticket._id} value={ticket._id}>{ticket.ticketId} · {ticket.title}</option>)}</select></Field>
                <ModalActions onClose={() => setRequesting(null)} submit="Send request" />
            </form>
        </ModalFrame>}
    </>
}

function NotificationsView({ items, onReadAll }) {
    return <><PageHeading eyebrow="Updates" title="Notifications" description="Ticket, asset and service updates for your account." action={<ActionButton secondary onClick={onReadAll}><Check size={15} />Mark all read</ActionButton>} /><div className="space-y-2">{items.length ? items.map((item) => <article key={item._id} className={`flex gap-4 rounded-md border bg-white p-4 ${item.readAt ? 'border-[#e5e9e9]' : 'border-[#c7e0db]'}`}><span className={`mt-1 size-2 rounded-full ${item.readAt ? 'bg-[#c6d0d1]' : 'bg-[#137c70]'}`} /><div><h3 className="text-sm font-semibold">{item.title}</h3><p className="mt-1 text-xs text-[#718086]">{item.message}</p><time className="mt-2 block text-[10px] text-[#9aa5a8]">{new Date(item.createdAt).toLocaleString()}</time></div></article>) : <section className="rounded-md border border-[#e0e6e7] bg-white p-10"><Empty message="You are all caught up." /></section>}</div></>
}

function ReportsView({ tickets, stats }) {
    const data = stats?.ticketCounts?.map(({ _id, count }) => ({ name: _id, count })) || []
    return <><PageHeading eyebrow="Analytics" title="Reports" description="Operational snapshot of ticket demand and service health." action={<button onClick={() => { const csv = ['Ticket,Title,Status,Priority,Created', ...tickets.map((ticket) => [ticket.ticketId, `"${ticket.title.replaceAll('"', '""')}"`, ticket.status, ticket.priority, ticket.createdAt].join(','))].join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'servicedesk-tickets.csv'; link.click(); URL.revokeObjectURL(link.href) }} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dbe2e2] bg-white px-3 text-xs font-semibold text-[#425158]"><ArrowDownToLine size={15} />Export CSV</button>} />
        <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-md border border-[#e0e6e7] bg-white p-5"><h2 className="mb-4 text-sm font-semibold">Ticket status</h2><div className="h-[280px]">{data.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid vertical={false} stroke="#edf0f0" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="count" fill="#137c70" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer> : <Empty message="Report data unavailable." />}</div></section><section className="rounded-md border border-[#e0e6e7] bg-white p-5"><h2 className="text-sm font-semibold">Service health</h2><div className="mt-6 grid grid-cols-2 gap-3"><StatCard label="Requests" value={stats?.totalTickets ?? tickets.length} icon={LifeBuoy} note="In your access scope" /><StatCard label="Open" value={stats?.openTickets ?? 0} icon={AlertCircle} note="Awaiting resolution" accent="#d7952b" /><StatCard label="SLA breaches" value={stats?.summary?.slaBreaches ?? 0} icon={Clock3} note="Past resolution target" accent="#be6157" /><StatCard label="Assets" value={stats?.assets ?? 0} icon={Boxes} note="Tracked inventory" accent="#4a79a5" /></div></section></div></>
}

function ProfileView({ user }) {
    return <><PageHeading eyebrow="Account" title="Profile" description="Your identity and access in ServiceDesk Pro." /><section className="max-w-2xl rounded-md border border-[#e0e6e7] bg-white p-6"><div className="mb-6 flex items-center gap-4"><div className="grid size-14 place-items-center rounded-full bg-[#e8efee] font-semibold text-[#137c70]">{initials(user.name)}</div><div><h2 className="font-semibold">{user.name}</h2><p className="mt-1 text-xs text-[#758287]">{user.role}</p></div></div><dl className="grid gap-4 border-t border-[#edf0f0] pt-5 sm:grid-cols-2"><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-[#93a0a3]">Email</dt><dd className="mt-1 text-sm">{user.email}</dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-[#93a0a3]">Department</dt><dd className="mt-1 text-sm">{user.department?.name || 'Not assigned'}</dd></div></dl></section></>
}

function TicketModal({ onClose, onSubmit }) {
    const [form, setForm] = useState({ title: '', description: '', priority: 'Medium', category: '' })
    const [categories, setCategories] = useState([])
    const [suggestion, setSuggestion] = useState(null)
    const [aiError, setAiError] = useState('')
    const [askingAi, setAskingAi] = useState(false)
    useEffect(() => { api.get('/categories').then(({ data }) => setCategories(data.items)).catch(() => { }) }, [])
    const update = (event) => setForm({ ...form, [event.target.name]: event.target.value })
    async function askForSuggestions() {
        setAskingAi(true)
        setAiError('')
        try {
            const { data } = await api.post('/ai/suggest', { title: form.title, description: form.description })
            setSuggestion(data.suggestion)
        } catch (error) { setAiError(error.response?.data?.error?.message || 'Suggestions are unavailable') }
        finally { setAskingAi(false) }
    }
    function applySuggestion() {
        const category = categories.find((item) => item.name === suggestion?.category)
        setForm({ ...form, priority: suggestion?.priority || form.priority, category: category?._id || form.category })
    }
    return <ModalFrame title="Create a service request" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onSubmit(form) }} className="space-y-4"><Field label="Subject"><input name="title" value={form.title} onChange={update} required maxLength={180} placeholder="Briefly describe what you need" className="input" /></Field><Field label="Description"><textarea name="description" value={form.description} onChange={update} required rows={4} placeholder="What happened? Include useful details." className="input resize-y" /></Field><div className="flex flex-wrap items-center gap-3"><button type="button" disabled={askingAi || (!form.title && !form.description)} onClick={askForSuggestions} className="inline-flex h-8 items-center gap-2 rounded border border-[#dce3e3] px-2.5 text-[11px] font-semibold text-[#536267] disabled:opacity-50"><Activity size={13} />{askingAi ? 'Analyzing…' : 'Suggest category & priority'}</button>{aiError && <span className="text-[11px] text-[#aa5148]">{aiError}</span>}</div>{suggestion && <div className="rounded-md border border-[#dbe8e5] bg-[#f5faf8] p-3 text-xs"><div className="font-semibold text-[#286d63]">Review AI suggestions</div><p className="mt-1 leading-5 text-[#596a6e]">{suggestion.probableIssue} · {suggestion.summary}</p><div className="mt-2 flex items-center justify-between"><span className="text-[#758287]">{suggestion.category} · {suggestion.priority}</span><button type="button" onClick={applySuggestion} className="font-semibold text-[#137c70]">Apply suggestions</button></div></div>}<div className="grid gap-4 sm:grid-cols-2"><Field label="Priority"><select name="priority" value={form.priority} onChange={update} className="input">{['Low', 'Medium', 'High', 'Critical'].map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Category"><select name="category" value={form.category} onChange={update} className="input"><option value="">Choose a category</option>{categories.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field></div><ModalActions onClose={onClose} submit="Create request" /></form></ModalFrame>
}

function ResourceModal({ title, onClose, onSubmit }) {
    const [form, setForm] = useState({})
    const [departments, setDepartments] = useState([])
    useEffect(() => { if (title === 'People') api.get('/departments').then(({ data }) => setDepartments(data.items)).catch(() => { }) }, [title])
    const fields = title === 'Assets' ? ['assetId', 'name', 'type', 'brand', 'serialNumber', 'warrantyEnd'] : title === 'Knowledge' ? ['title', 'category', 'problem', 'solution', 'tags'] : title === 'People' ? ['name', 'email', 'role', 'department', 'password'] : title === 'Categories' ? ['name', 'subcategories'] : title === 'SLA policies' ? ['name', 'priority', 'responseMinutes', 'resolutionMinutes'] : ['name', 'description']
    function submitForm(event) {
        event.preventDefault()
        const payload = { ...form }
        if (title === 'People') payload.role = form.role || 'Employee'
        if (title === 'Knowledge') { payload.status = 'Published'; payload.tags = String(form.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean) }
        if (title === 'Categories') payload.subcategories = String(form.subcategories || '').split(',').map((value) => value.trim()).filter(Boolean)
        if (title === 'SLA policies') { payload.responseMinutes = Number(form.responseMinutes); payload.resolutionMinutes = Number(form.resolutionMinutes) }
        onSubmit(payload)
    }
    const roleOptions = ['IT Manager', 'Technician', 'Employee', 'Asset Manager']
    return <ModalFrame title={`Add ${title === 'Knowledge' ? 'knowledge article' : title === 'SLA policies' ? 'SLA policy' : title === 'People' ? 'user' : title.slice(0, -1)}`} onClose={onClose}><form onSubmit={submitForm} className="space-y-4">{fields.map((field) => <Field key={field} label={field.replace(/([A-Z])/g, ' $1')}>{field === 'solution' || field === 'problem' ? <textarea className="input" rows={3} value={form[field] || ''} onChange={(event) => setForm({ ...form, [field]: event.target.value })} required /> : field === 'role' ? <select className="input" value={form.role || 'Employee'} onChange={(event) => setForm({ ...form, role: event.target.value })}>{roleOptions.map((role) => <option key={role}>{role}</option>)}</select> : field === 'priority' ? <select className="input" value={form.priority || 'Medium'} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{['Low', 'Medium', 'High', 'Critical'].map((priority) => <option key={priority}>{priority}</option>)}</select> : field === 'department' ? <select className="input" value={form.department || ''} onChange={(event) => setForm({ ...form, department: event.target.value })}><option value="">Choose department</option>{departments.map((department) => <option key={department._id} value={department._id}>{department.name}</option>)}</select> : field === 'status' && title === 'Assets' ? <select className="input" value={form[field] || 'Available'} onChange={(event) => setForm({ ...form, [field]: event.target.value })}>{['Available', 'Assigned', 'Under Repair', 'Lost', 'Damaged', 'Retired'].map((value) => <option key={value}>{value}</option>)}</select> : <input className="input" type={field === 'email' ? 'email' : field === 'password' ? 'password' : field === 'warrantyEnd' ? 'date' : ['responseMinutes', 'resolutionMinutes'].includes(field) ? 'number' : 'text'} min={['responseMinutes', 'resolutionMinutes'].includes(field) ? 1 : undefined} value={form[field] || ''} onChange={(event) => setForm({ ...form, [field]: event.target.value })} required={['name', 'title', 'email', 'password', 'responseMinutes', 'resolutionMinutes'].includes(field)} />}</Field>)}<ModalActions onClose={onClose} submit="Save record" /></form></ModalFrame>
}

function TicketPanel({ ticket, user, onClose, onStatus, onUpdated, onToast }) {
    const [details, setDetails] = useState(null)
    const [comment, setComment] = useState('')
    const [internal, setInternal] = useState(false)
    const [replying, setReplying] = useState(false)
    const [technicians, setTechnicians] = useState([])
    const [technicianId, setTechnicianId] = useState('')
    const [declineReason, setDeclineReason] = useState('')
    const [workDescription, setWorkDescription] = useState('')
    const [workMinutes, setWorkMinutes] = useState('15')
    const [savingWork, setSavingWork] = useState(false)
    const canManageAssignment = ['System Admin', 'IT Manager'].includes(user.role)
    const isAssignedTechnician = user.role === 'Technician' && ticket.assignedTo?._id === user.id
    const latestAssignment = ticket.assignmentRequests?.at(-1)
    const pendingAssignment = latestAssignment?.status === 'Pending' ? latestAssignment : null
    const myPendingAssignment = pendingAssignment?.technician?._id === user.id
    const roleStatusActions = {
        'System Admin': ['Pending', 'Escalated', 'Reopened'],
        'IT Manager': ['Pending', 'Escalated'],
        Technician: isAssignedTechnician ? ['In Progress', 'Pending', 'Escalated', 'Resolved'] : [],
    }[user.role] || []
    const statusActions = roleStatusActions.filter((status) => {
        if (status === 'Reopened') return ['Resolved', 'Closed'].includes(ticket.status)
        if (['Resolved', 'Closed'].includes(ticket.status)) return false
        if (status === 'In Progress') return ['Assigned', 'Pending', 'In Progress'].includes(ticket.status)
        if (status === 'Resolved') return ['In Progress', 'Pending', 'Escalated'].includes(ticket.status)
        return status !== ticket.status
    })
    const statusActionHint = {
        'System Admin': 'Platform oversight controls',
        'IT Manager': 'Manager controls: place on hold or escalate',
        Technician: 'Technician controls: update your accepted work',
    }[user.role]
    useEffect(() => {
        api.get(`/tickets/${ticket._id}`).then(({ data }) => setDetails(data)).catch(() => { })
    }, [ticket._id, ticket.updatedAt])
    async function sendComment(event) {
        event.preventDefault()
        setReplying(true)
        try { await api.post(`/tickets/${ticket._id}/comments`, { body: comment, internal }); setComment(''); onToast(internal ? 'Internal note added' : 'Reply sent'); const { data } = await api.get(`/tickets/${ticket._id}`); setDetails(data); onUpdated() }
        catch (error) { onToast(error.response?.data?.error?.message || 'Could not send reply') }
        finally { setReplying(false) }
    }
    useEffect(() => {
        if (canManageAssignment) {
            api.get('/technicians').then(({ data }) => setTechnicians(data.items)).catch(() => { })
        }
    }, [canManageAssignment])
    async function assignTechnician() {
        try {
            await api.patch(`/tickets/${ticket._id}/assign`, { technician: technicianId })
            onToast('Acceptance request sent to technician')
            setTechnicianId('')
            onUpdated()
        } catch (error) {
            onToast(error.response?.data?.error?.message || 'Could not request technician acceptance')
        }
    }
    async function respondToAssignment(decision) {
        try {
            await api.patch(`/tickets/${ticket._id}/assignment-response`, { decision, reason: declineReason })
            setDeclineReason('')
            onToast(decision === 'accept' ? 'Assignment accepted. You can now start work.' : 'Assignment declined and manager notified')
            const { data } = await api.get(`/tickets/${ticket._id}`)
            setDetails(data)
            onUpdated()
        } catch (error) {
            onToast(error.response?.data?.error?.message || 'Could not respond to assignment')
        }
    }
    async function logWork(event) {
        event.preventDefault()
        setSavingWork(true)
        try {
            await api.post(`/tickets/${ticket._id}/worklogs`, { description: workDescription, minutes: Number(workMinutes) })
            setWorkDescription('')
            onToast('Work update shared with the requester and manager')
            const { data } = await api.get(`/tickets/${ticket._id}`)
            setDetails(data)
            onUpdated()
        } catch (error) {
            onToast(error.response?.data?.error?.message || 'Could not save work update')
        } finally {
            setSavingWork(false)
        }
    }
    const assignmentMessage = pendingAssignment
        ? `Waiting for ${pendingAssignment.technician?.name || 'the selected technician'} to accept or decline.`
        : latestAssignment?.status === 'Declined'
            ? `${latestAssignment.technician?.name || 'Technician'} declined: ${latestAssignment.reason}`
            : latestAssignment?.status === 'Accepted'
                ? `${latestAssignment.technician?.name || 'Technician'} accepted this request.`
                : ''
    const employeeActions = user.role === 'Employee'
        ? [
            ...(ticket.status === 'Resolved' ? [{ status: 'Closed', label: 'Confirm resolution' }] : []),
            ...(['Resolved', 'Closed'].includes(ticket.status) ? [{ status: 'Reopened', label: 'Reopen request' }] : []),
        ]
        : []
    return <div className="fixed inset-0 z-50 flex justify-end bg-[#172526]/30" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <aside className="flex h-full w-full max-w-[620px] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e5eaea] px-6 py-4">
                <div><div className="text-[11px] font-semibold text-[#137c70]">{ticket.ticketId}</div><div className="mt-1 max-w-[460px] truncate text-sm font-semibold">{ticket.title}</div></div>
                <button aria-label="Close ticket" onClick={onClose} className="rounded p-2 text-[#78868a] hover:bg-[#f2f5f5]"><X size={18} /></button>
            </div>
            <div className="flex-1 space-y-6 overflow-y-auto p-6">
                <div className="flex flex-wrap gap-2"><Badge value={ticket.status} /><Badge value={ticket.priority} /></div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#56656a]">{ticket.description}</p>
                <div className="grid grid-cols-2 gap-4 border-y border-[#edf0f0] py-4 text-xs">
                    <div><span className="text-[#8b989c]">Requester</span><div className="mt-1 font-medium">{ticket.employee?.name || '—'}</div></div>
                    <div><span className="text-[#8b989c]">Assigned technician</span><div className="mt-1 font-medium">{ticket.assignedTo?.name || 'Not assigned yet'}</div></div>
                    <div><span className="text-[#8b989c]">Department</span><div className="mt-1 font-medium">{ticket.department?.name || '—'}</div></div>
                    <div><span className="text-[#8b989c]">Created</span><div className="mt-1 font-medium">{new Date(ticket.createdAt).toLocaleString()}</div></div>
                </div>
                {assignmentMessage && <div className={`rounded-md border p-3 text-xs ${latestAssignment?.status === 'Declined' ? 'border-[#f0d2cf] bg-[#fff8f7] text-[#a4443d]' : 'border-[#dbe8e5] bg-[#f5faf8] text-[#426d66]'}`}>
                    <div className="font-semibold">Technician assignment</div>
                    <p className="mt-1">{assignmentMessage}</p>
                </div>}
                {canManageAssignment && <section className="space-y-2">
                    <h3 className="text-xs font-semibold text-[#536267]">Request technician acceptance</h3>
                    <div className="flex gap-2">
                        <select aria-label="Choose technician" value={technicianId} onChange={(event) => setTechnicianId(event.target.value)} className="input h-9" disabled={Boolean(pendingAssignment)}>
                            <option value="">Choose technician</option>
                            {technicians.map((person) => <option key={person._id} value={person._id}>{person.name}</option>)}
                        </select>
                        <button type="button" disabled={!technicianId || Boolean(pendingAssignment)} onClick={assignTechnician} className="h-9 whitespace-nowrap rounded bg-[#137c70] px-3 text-xs font-semibold text-white disabled:opacity-50">Request acceptance</button>
                    </div>
                    {pendingAssignment && <p className="text-[11px] text-[#89969a]">Wait for this technician to accept or decline before sending another request.</p>}
                </section>}
                {myPendingAssignment && <section className="space-y-3 rounded-md border border-[#dbe8e5] bg-[#f8fbfa] p-4">
                    <div><h3 className="text-sm font-semibold">Can you take this request?</h3><p className="mt-1 text-xs text-[#728084]">Accept to become the assigned technician, or decline and tell the manager why.</p></div>
                    <textarea value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} rows={2} maxLength={1000} placeholder="Reason if unavailable" className="input resize-y" />
                    <div className="flex gap-2">
                        <button type="button" onClick={() => respondToAssignment('accept')} className="h-8 rounded bg-[#137c70] px-3 text-xs font-semibold text-white">Accept request</button>
                        <button type="button" disabled={!declineReason.trim()} onClick={() => respondToAssignment('decline')} className="h-8 rounded border border-[#dfe6e6] px-3 text-xs font-semibold text-[#536267] disabled:opacity-50">Decline with reason</button>
                    </div>
                </section>}
                {statusActions.length > 0 && <section>
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#89969a]">{statusActionHint}</h3>
                    <div className="flex flex-wrap gap-2">{statusActions.filter((status) => status !== ticket.status).map((status) => <button key={status} onClick={() => onStatus(ticket, status)} className="rounded border border-[#dfe6e6] px-2.5 py-1.5 text-[11px] font-medium text-[#536267] hover:border-[#a7cbc5] hover:text-[#137c70]">{user.role === 'Technician' && status === 'In Progress' ? 'Start work' : `Set ${status}`}</button>)}</div>
                </section>}
                {employeeActions.map(({ status, label }) => <button key={status} onClick={() => onStatus(ticket, status)} className="w-fit rounded border border-[#dfe6e6] px-2.5 py-1.5 text-[11px] font-medium text-[#536267]">{label}</button>)}
                {isAssignedTechnician && ticket.status === 'In Progress' && <form onSubmit={logWork} className="space-y-2 rounded-md border border-[#e0e6e7] p-4">
                    <h3 className="text-xs font-semibold text-[#536267]">Share a work progress update</h3>
                    <textarea value={workDescription} onChange={(event) => setWorkDescription(event.target.value)} required maxLength={2000} rows={2} placeholder="Describe what you completed or what you are working on" className="input resize-y" />
                    <div className="flex items-center justify-between gap-3"><label className="flex items-center gap-2 text-[11px] text-[#758287]">Minutes worked<input type="number" min="1" max="1440" required value={workMinutes} onChange={(event) => setWorkMinutes(event.target.value)} className="input h-8 w-24" /></label><button disabled={savingWork} className="h-8 rounded bg-[#137c70] px-3 text-xs font-semibold text-white disabled:opacity-60">{savingWork ? 'Sharing…' : 'Share update'}</button></div>
                </form>}
                <section>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#667579]">Conversation</h3>
                    <div className="space-y-3">{details?.comments?.length ? details.comments.map((entry) => <article key={entry._id} className={`rounded-md p-3 ${entry.internal ? 'bg-[#fff8ec]' : 'bg-[#f5f8f8]'}`}><div className="flex justify-between text-[10px] font-semibold"><span>{entry.author?.name || 'Support'} {entry.internal && <span className="ml-1 text-[#aa7725]">· Internal note</span>}</span><time className="font-normal text-[#97a2a5]">{new Date(entry.createdAt).toLocaleString()}</time></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#59676c]">{entry.body}</p></article>) : <p className="text-xs text-[#98a3a6]">No replies yet.</p>}</div>
                </section>
                <section>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#667579]">Work progress</h3>
                    <div className="space-y-2">{details?.workLogs?.length ? details.workLogs.map((entry) => <article key={entry._id} className="rounded-md bg-[#f5f8f8] p-3"><div className="flex justify-between gap-3 text-[10px] font-semibold"><span>{entry.technician?.name || 'Technician'} · {entry.minutes} min</span><time className="font-normal text-[#97a2a5]">{new Date(entry.workedAt).toLocaleString()}</time></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#59676c]">{entry.description}</p></article>) : <p className="text-xs text-[#98a3a6]">No work updates have been shared yet.</p>}</div>
                </section>
                <section>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#667579]">Activity</h3>
                    {ticket.history?.length
                        ? <div className="space-y-2">{[...ticket.history].reverse().map((event, index) => <div key={index} className="flex gap-3 text-[11px] text-[#728084]"><span className="mt-1 size-1.5 rounded-full bg-[#90b7af]" /><span>{event.action}{event.to && typeof event.to === 'string' ? ` · ${event.to}` : ''}<time className="ml-2 text-[#a1abad]">{new Date(event.at).toLocaleString()}</time></span></div>)}</div>
                        : <p className="text-xs text-[#98a3a6]">No activity recorded.</p>}
                </section>
            </div>
            <form onSubmit={sendComment} className="border-t border-[#e5eaea] p-5">
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} required rows={3} placeholder={internal ? 'Add an internal note…' : 'Write a reply…'} className="input resize-none" />
                {['System Admin', 'IT Manager', 'Technician'].includes(user.role) && <label className="mt-2 flex items-center gap-2 text-[11px] text-[#758287]"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />Internal note visible to support staff only</label>}
                <div className="mt-3 flex justify-between"><span className="text-[10px] text-[#9aa5a8]">Use clear, actionable details</span><button disabled={replying} className="inline-flex h-8 items-center gap-2 rounded bg-[#137c70] px-3 text-xs font-semibold text-white disabled:opacity-60"><Send size={13} />{replying ? 'Sending…' : 'Send reply'}</button></div>
            </form>
        </aside>
    </div>
}

function ModalFrame({ title, onClose, children }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#172526]/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="max-h-[90vh] w-full max-w-[600px] overflow-y-auto rounded-md bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#e8eded] px-6 py-4"><h2 className="text-sm font-semibold">{title}</h2><button onClick={onClose} aria-label="Close dialog" className="rounded p-1.5 text-[#758287] hover:bg-[#f3f6f6]"><X size={17} /></button></div><div className="p-6">{children}</div></section></div> }
function Field({ label, children }) { return <label className="block text-[11px] font-semibold capitalize text-[#59676c]">{label}{children}</label> }
function ModalActions({ onClose, submit }) { return <div className="flex justify-end gap-2 border-t border-[#edf0f0] pt-4"><button type="button" onClick={onClose} className="h-9 rounded-md border border-[#dce3e3] px-3 text-xs font-medium text-[#59676c]">Cancel</button><button className="h-9 rounded-md bg-[#137c70] px-3 text-xs font-semibold text-white">{submit}</button></div> }

export default App