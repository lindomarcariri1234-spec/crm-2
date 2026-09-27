// Adapted literally from pages/vitrine/layout.tsx. Clerk, attribution,
// metadata and notifications are intentionally inert in the local preview.
import { ReactNode, useState } from "react";
import { Search, Menu, X, UserCircle, ChevronDown, Instagram, Facebook, Youtube, Mail, Phone, MapPin, LogOut, Share2 } from "lucide-react";

export default function VitrineLayout({ children, slug, store }: { children: ReactNode; slug: string; store: any }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const navigate = (path: string) => { window.location.hash = path; };
  const links = [
    ["Início", `/loja/${slug}`],
    ["Pacotes", `/loja/${slug}/produtos`],
    ["Calendário", `/loja/${slug}/calendario`],
    ["Meu Pedido", `/loja/${slug}/consultar-pedido`],
  ];
  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); if (searchQuery.trim()) navigate(`/loja/${slug}/produtos?search=${encodeURIComponent(searchQuery.trim())}`); setSearchOpen(false); };
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 border-b shadow-sm" style={{ backgroundColor: "#1E5B8C" }}>
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => navigate(`/loja/${slug}`)} className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-white/20 flex items-center justify-center font-bold text-white text-lg">{store.name.charAt(0)}</div>
            <span className="text-white font-bold text-lg hidden sm:block">{store.name}</span>
          </button>
          <nav className="hidden md:flex items-center gap-6">
            {links.map(([label, href]) => <a key={label} href={`#${href}`} className="text-white/90 hover:text-white text-sm font-medium">{label}</a>)}
            {store.contactWhatsapp && <a href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`} className="text-white/90 text-sm font-medium">WhatsApp</a>}
            <div className="flex items-center gap-2"><a href="#entrar" className="flex items-center gap-1.5 text-white/90 bg-white/10 px-3 py-1.5 rounded-lg text-sm"><UserCircle className="w-4 h-4"/> Entrar</a><a href="#cadastrar" className="bg-white text-gray-900 px-3 py-1.5 rounded-lg text-sm font-medium">Criar conta</a></div>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={() => setSearchOpen(v => !v)} className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 text-white" aria-label="Buscar"><Search className="w-4 h-4"/></button>
            <button onClick={() => setMobileMenuOpen(v => !v)} className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 text-white"><Menu className="w-5 h-5"/></button>
          </div>
        </div>
        {searchOpen && <div className="border-t border-white/10 px-4 py-3"><form onSubmit={handleSearch} className="max-w-lg mx-auto flex gap-2"><input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar destinos, pacotes..." className="flex-1 px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm"/><button className="px-4 rounded-lg bg-white/20 text-white text-sm">Buscar</button><button type="button" onClick={() => setSearchOpen(false)} className="w-9 rounded-lg bg-white/10 text-white"><X className="w-4 h-4"/></button></form></div>}
        {mobileMenuOpen && <div className="md:hidden border-t border-white/10 px-4 py-3 space-y-2">{links.map(([label, href]) => <a key={label} href={`#${href}`} onClick={() => setMobileMenuOpen(false)} className="block text-white/90 text-sm font-medium py-1">{label}</a>)}{store.contactWhatsapp && <a href={`https://wa.me/${store.contactWhatsapp}`} className="block text-white/90 text-sm py-1">WhatsApp</a>}<a href="#entrar" className="block text-white/90 text-sm py-1"><UserCircle className="inline w-4 h-4 mr-2"/>Entrar</a><a href="#cadastrar" className="block text-white/90 text-sm py-1">Criar conta</a></div>}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t bg-gray-900 text-gray-300">
        <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div><h3 className="text-white font-bold mb-3">{store.name}</h3><p className="text-sm leading-relaxed">{store.description}</p><div className="flex gap-3 mt-4"><Instagram className="w-5 h-5"/><Facebook className="w-5 h-5"/><Youtube className="w-5 h-5"/></div></div>
          <div><h3 className="text-white font-bold mb-3">Links Rápidos</h3><div className="space-y-2 text-sm">{links.map(([label,href]) => <div key={label}><a href={`#${href}`} className="hover:text-white">{label === "Pacotes" ? "Ver Pacotes" : label}</a></div>)}</div></div>
          <div><h3 className="text-white font-bold mb-3">Contato</h3><div className="space-y-2 text-sm"><div className="flex items-center gap-2"><Mail className="w-4 h-4"/>{store.contactEmail}</div><div className="flex items-center gap-2"><Phone className="w-4 h-4"/>{store.contactPhone}</div><div className="flex items-start gap-2"><MapPin className="w-4 h-4 mt-0.5"/>{store.contactAddress}</div></div></div>
        </div><div className="border-t border-gray-800 text-center py-4 text-xs text-gray-500">© 2025 {store.name} · Powered by VisiteCRM</div>
      </footer>
    </div>
  );
}