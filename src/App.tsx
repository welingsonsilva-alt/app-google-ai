import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  doc, 
  updateDoc, 
  arrayUnion, 
  arrayRemove,
  getDoc,
  FirestoreError
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { db, auth } from './firebase';
import { 
  Search, 
  MapPin, 
  Plus, 
  User as UserIcon, 
  Star, 
  ChevronRight, 
  X,
  Compass,
  Heart,
  Calendar,
  Info,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { searchTerreiros } from './services/geminiService';
import Markdown from 'react-markdown';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Error Handling Spec for Firestore Permissions
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We can show a toast or alert here in a real app
}

// Error Boundary Component
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.includes('{"error":')) {
        setHasError(true);
        try {
          const parsed = JSON.parse(event.error.message);
          setErrorMsg(`Erro de permissão no Firestore (${parsed.operationType} em ${parsed.path}). Verifique as regras de segurança.`);
        } catch {
          setErrorMsg('Ocorreu um erro inesperado no banco de dados.');
        }
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-stone-900 mb-2">Ops! Algo deu errado</h2>
          <p className="text-stone-600 text-sm mb-6">{errorMsg}</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-stone-900 text-white px-6 py-2 rounded-full text-sm font-bold hover:bg-stone-800 transition-all"
          >
            Recarregar Aplicativo
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// Types
interface Terreiro {
  id: string;
  name: string;
  address: string;
  description?: string;
  type: 'Umbanda' | 'Candomblé' | 'Misto';
  schedule?: string[];
  photoURL?: string;
  authorUid?: string;
  rating?: number;
}

interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  favorites: string[];
}

export default function App() {
  return (
    <ErrorBoundary>
      <AxéFinderApp />
    </ErrorBoundary>
  );
}

function AxéFinderApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [terreiros, setTerreiros] = useState<Terreiro[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [aiResult, setAiResult] = useState<{ text: string; links: string[] } | null>(null);
  const [selectedTerreiro, setSelectedTerreiro] = useState<Terreiro | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const userDoc = await getDoc(doc(db, 'users', u.uid));
          if (userDoc.exists()) {
            setProfile(userDoc.data() as UserProfile);
          } else {
            const newProfile = {
              uid: u.uid,
              displayName: u.displayName || 'Usuário',
              photoURL: u.photoURL || '',
              favorites: [],
              role: 'user'
            };
            // Use setDoc to ensure the ID matches the UID
            const { setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'users', u.uid), newProfile);
            setProfile(newProfile as any);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Firestore Listener
  useEffect(() => {
    const q = query(collection(db, 'terreiros'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Terreiro));
      setTerreiros(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'terreiros');
    });
    return unsubscribe;
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setAiResult(null);
    
    // Get user location if possible
    let location = undefined;
    if (navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch (err) {
        console.warn("Geolocation denied or failed");
      }
    }

    const result = await searchTerreiros(searchQuery, location);
    setAiResult(result);
    setIsSearching(false);
  };

  const toggleFavorite = async (terreiroId: string) => {
    if (!user || !profile) return;
    const isFav = profile.favorites.includes(terreiroId);
    const userRef = doc(db, 'users', user.uid);
    
    try {
      if (isFav) {
        await updateDoc(userRef, { favorites: arrayRemove(terreiroId) });
        setProfile({ ...profile, favorites: profile.favorites.filter(id => id !== terreiroId) });
      } else {
        await updateDoc(userRef, { favorites: arrayUnion(terreiroId) });
        setProfile({ ...profile, favorites: [...profile.favorites, terreiroId] });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFCF8] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <Compass className="w-12 h-12 text-emerald-700" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFCF8] text-stone-900 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-emerald-700 rounded-full flex items-center justify-center text-white shadow-lg shadow-emerald-700/20">
              <Compass className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-emerald-900">Axé Finder</h1>
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setShowAddModal(true)}
                  className="hidden md:flex items-center gap-2 bg-emerald-700 text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-emerald-800 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Divulgar Terreiro
                </button>
                <div className="flex items-center gap-2 pl-4 border-l border-stone-200">
                  <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-stone-200" referrerPolicy="no-referrer" />
                  <button onClick={handleLogout} className="text-xs font-medium text-stone-500 hover:text-stone-900">Sair</button>
                </div>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-stone-900 text-white px-5 py-2 rounded-full text-sm font-medium hover:bg-stone-800 transition-colors"
              >
                <UserIcon className="w-4 h-4" />
                Entrar
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Hero & Search */}
        <section className="mb-12 text-center max-w-2xl mx-auto">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-serif font-bold text-stone-900 mb-4"
          >
            Encontre o seu <span className="text-emerald-700 italic">Axé</span>
          </motion.h2>
          <p className="text-stone-600 mb-8">Busque terreiros, consulte horários de giras e conecte-se com a espiritualidade em sua região.</p>
          
          <form onSubmit={handleSearch} className="relative group">
            <input 
              type="text" 
              placeholder="Ex: Terreiros em São Paulo, Umbanda no Rio..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border-2 border-stone-200 rounded-2xl py-4 pl-14 pr-4 focus:border-emerald-700 focus:ring-0 transition-all shadow-sm group-hover:shadow-md outline-none"
            />
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-stone-400 group-focus-within:text-emerald-700 transition-colors" />
            <button 
              type="submit"
              disabled={isSearching}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-emerald-700 text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-emerald-800 disabled:opacity-50 transition-all"
            >
              {isSearching ? 'Buscando...' : 'Buscar'}
            </button>
          </form>
        </section>

        {/* AI Discovery Result */}
        <AnimatePresence>
          {aiResult && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mb-12 bg-emerald-50 border border-emerald-100 rounded-3xl p-6 md:p-8"
            >
              <div className="flex items-start gap-4 mb-6">
                <div className="w-10 h-10 bg-emerald-700 rounded-xl flex items-center justify-center text-white shrink-0">
                  <Star className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-emerald-900">Recomendações do Axé Finder</h3>
                  <p className="text-emerald-700/70 text-sm">Baseado em informações em tempo real do Google Maps</p>
                </div>
              </div>
              
              <div className="prose prose-emerald max-w-none mb-6 text-emerald-900/80">
                <Markdown>{aiResult.text}</Markdown>
              </div>

              {aiResult.links.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {aiResult.links.map((link, i) => (
                    <a 
                      key={i} 
                      href={link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 bg-white border border-emerald-200 px-4 py-2 rounded-full text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                      <MapPin className="w-4 h-4" />
                      Ver no Mapa
                    </a>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Featured Terreiros */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-serif font-bold text-stone-900">Terreiros Cadastrados</h3>
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-stone-100 rounded-full text-xs font-bold text-stone-500 uppercase tracking-wider">Todos</span>
              <span className="px-3 py-1 bg-white border border-stone-200 rounded-full text-xs font-bold text-stone-400 uppercase tracking-wider cursor-pointer hover:bg-stone-50">Umbanda</span>
              <span className="px-3 py-1 bg-white border border-stone-200 rounded-full text-xs font-bold text-stone-400 uppercase tracking-wider cursor-pointer hover:bg-stone-50">Candomblé</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {terreiros.map((t) => (
              <motion.div 
                key={t.id}
                layoutId={t.id}
                onClick={() => setSelectedTerreiro(t)}
                className="bg-white border border-stone-200 rounded-3xl overflow-hidden group cursor-pointer hover:shadow-xl hover:shadow-stone-200/50 transition-all duration-300"
              >
                <div className="aspect-[16/9] relative overflow-hidden bg-stone-100">
                  <img 
                    src={t.photoURL || `https://picsum.photos/seed/${t.id}/800/450`} 
                    alt={t.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute top-4 left-4">
                    <span className="bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest text-emerald-700 shadow-sm">
                      {t.type}
                    </span>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(t.id);
                    }}
                    className={cn(
                      "absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center backdrop-blur transition-all",
                      profile?.favorites.includes(t.id) 
                        ? "bg-red-500 text-white" 
                        : "bg-white/90 text-stone-400 hover:text-red-500"
                    )}
                  >
                    <Heart className={cn("w-5 h-5", profile?.favorites.includes(t.id) && "fill-current")} />
                  </button>
                </div>
                
                <div className="p-6">
                  <div className="flex items-center gap-1 mb-2">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star key={s} className={cn("w-3 h-3", s <= (t.rating || 5) ? "text-amber-400 fill-current" : "text-stone-200")} />
                    ))}
                    <span className="text-[10px] font-bold text-stone-400 ml-1 uppercase tracking-tighter">4.9 (24 avaliações)</span>
                  </div>
                  <h4 className="text-xl font-bold text-stone-900 mb-1 group-hover:text-emerald-700 transition-colors">{t.name}</h4>
                  <div className="flex items-start gap-1 text-stone-500 text-sm mb-4">
                    <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="line-clamp-1">{t.address}</span>
                  </div>
                  
                  <div className="flex items-center justify-between pt-4 border-t border-stone-100">
                    <div className="flex items-center gap-2 text-stone-400 text-xs font-medium">
                      <Calendar className="w-4 h-4" />
                      <span>Gira hoje às 19:30</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-stone-300 group-hover:text-emerald-700 group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </motion.div>
            ))}

            {terreiros.length === 0 && !isSearching && (
              <div className="col-span-full py-20 text-center bg-stone-50 rounded-3xl border-2 border-dashed border-stone-200">
                <Compass className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                <h4 className="text-xl font-bold text-stone-400">Nenhum terreiro cadastrado ainda</h4>
                <p className="text-stone-400 text-sm">Seja o primeiro a divulgar uma casa de axé!</p>
                <button 
                  onClick={() => setShowAddModal(true)}
                  className="mt-6 bg-stone-900 text-white px-6 py-2 rounded-full text-sm font-bold hover:bg-stone-800 transition-all"
                >
                  Cadastrar Terreiro
                </button>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-stone-200 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Compass className="w-6 h-6 text-emerald-700" />
              <h1 className="text-xl font-bold tracking-tight text-emerald-900">Axé Finder</h1>
            </div>
            <p className="text-stone-500 text-sm max-w-sm">
              Nossa missão é facilitar o encontro entre as pessoas e a espiritualidade, 
              fortalecendo a comunidade de Umbanda e Candomblé através da tecnologia e união.
            </p>
          </div>
          <div>
            <h5 className="font-bold text-stone-900 mb-4 uppercase text-xs tracking-widest">Plataforma</h5>
            <ul className="space-y-2 text-sm text-stone-500">
              <li><a href="#" className="hover:text-emerald-700">Sobre nós</a></li>
              <li><a href="#" className="hover:text-emerald-700">Como funciona</a></li>
              <li><a href="#" className="hover:text-emerald-700">Divulgar Casa</a></li>
              <li><a href="#" className="hover:text-emerald-700">Privacidade</a></li>
            </ul>
          </div>
          <div>
            <h5 className="font-bold text-stone-900 mb-4 uppercase text-xs tracking-widest">Contato</h5>
            <ul className="space-y-2 text-sm text-stone-500">
              <li><a href="#" className="hover:text-emerald-700">Suporte</a></li>
              <li><a href="#" className="hover:text-emerald-700">Instagram</a></li>
              <li><a href="#" className="hover:text-emerald-700">Facebook</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 mt-12 pt-8 border-t border-stone-100 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-stone-400">© 2026 Axé Finder. Respeito e união.</p>
          <div className="flex gap-6">
            <span className="text-[10px] font-bold text-stone-300 uppercase tracking-widest">Saravá</span>
            <span className="text-[10px] font-bold text-stone-300 uppercase tracking-widest">Kolofé</span>
            <span className="text-[10px] font-bold text-stone-300 uppercase tracking-widest">Mukuiu</span>
          </div>
        </div>
      </footer>

      {/* Details Modal */}
      <AnimatePresence>
        {selectedTerreiro && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTerreiro(null)}
              className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
            />
            <motion.div 
              layoutId={selectedTerreiro.id}
              className="relative bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[2rem] shadow-2xl"
            >
              <button 
                onClick={() => setSelectedTerreiro(null)}
                className="absolute top-6 right-6 z-10 w-10 h-10 bg-white/90 backdrop-blur rounded-full flex items-center justify-center text-stone-900 hover:bg-stone-100 transition-all"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="grid grid-cols-1 md:grid-cols-2">
                <div className="h-64 md:h-full bg-stone-100">
                  <img 
                    src={selectedTerreiro.photoURL || `https://picsum.photos/seed/${selectedTerreiro.id}/800/800`} 
                    alt="" 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="p-8 md:p-12">
                  <span className="inline-block bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest mb-4">
                    {selectedTerreiro.type}
                  </span>
                  <h2 className="text-3xl font-serif font-bold text-stone-900 mb-2">{selectedTerreiro.name}</h2>
                  <div className="flex items-center gap-2 mb-6">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map(s => (
                        <Star key={s} className={cn("w-4 h-4", s <= 5 ? "text-amber-400 fill-current" : "text-stone-200")} />
                      ))}
                    </div>
                    <span className="text-sm font-bold text-stone-400">4.9 (24 avaliações)</span>
                  </div>

                  <div className="space-y-6 mb-8">
                    <div className="flex items-start gap-3">
                      <MapPin className="w-5 h-5 text-emerald-700 shrink-0 mt-1" />
                      <div>
                        <h5 className="font-bold text-stone-900 text-sm">Localização</h5>
                        <p className="text-stone-500 text-sm">{selectedTerreiro.address}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Calendar className="w-5 h-5 text-emerald-700 shrink-0 mt-1" />
                      <div>
                        <h5 className="font-bold text-stone-900 text-sm">Próximas Giras</h5>
                        <ul className="text-stone-500 text-sm space-y-1 mt-1">
                          <li>• Terça-feira: Gira de Pretos Velhos (19:30)</li>
                          <li>• Sábado: Gira de Caboclos (18:00)</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Info className="w-5 h-5 text-emerald-700 shrink-0 mt-1" />
                      <div>
                        <h5 className="font-bold text-stone-900 text-sm">Sobre a Casa</h5>
                        <p className="text-stone-500 text-sm leading-relaxed">
                          {selectedTerreiro.description || "Uma casa de axé dedicada ao amor, caridade e evolução espiritual através dos fundamentos da Umbanda Sagrada."}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button className="flex-1 bg-emerald-700 text-white py-4 rounded-2xl font-bold hover:bg-emerald-800 transition-all shadow-lg shadow-emerald-700/20">
                      Como Chegar
                    </button>
                    <button 
                      onClick={() => toggleFavorite(selectedTerreiro.id)}
                      className={cn(
                        "w-14 h-14 rounded-2xl flex items-center justify-center border-2 transition-all",
                        profile?.favorites.includes(selectedTerreiro.id)
                          ? "bg-red-50 border-red-200 text-red-500"
                          : "border-stone-200 text-stone-400 hover:border-red-200 hover:text-red-500"
                      )}
                    >
                      <Heart className={cn("w-6 h-6", profile?.favorites.includes(selectedTerreiro.id) && "fill-current")} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="relative bg-white w-full max-w-lg rounded-[2rem] p-8 md:p-10 shadow-2xl"
            >
              <button 
                onClick={() => setShowAddModal(false)}
                className="absolute top-6 right-6 text-stone-400 hover:text-stone-900"
              >
                <X className="w-6 h-6" />
              </button>

              <h2 className="text-2xl font-serif font-bold text-stone-900 mb-2">Divulgar Terreiro</h2>
              <p className="text-stone-500 text-sm mb-8">Ajude outras pessoas a encontrarem o axé da sua casa.</p>

              <form className="space-y-4" onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const data = {
                  name: formData.get('name') as string,
                  address: formData.get('address') as string,
                  type: formData.get('type') as any,
                  description: formData.get('description') as string,
                  authorUid: user?.uid,
                  createdAt: serverTimestamp(),
                };
                try {
                  await addDoc(collection(db, 'terreiros'), data);
                  setShowAddModal(false);
                } catch (error) {
                  handleFirestoreError(error, OperationType.CREATE, 'terreiros');
                }
              }}>
                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1.5 ml-1">Nome do Terreiro</label>
                  <input name="name" required className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 outline-none focus:border-emerald-700 transition-all" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1.5 ml-1">Endereço Completo</label>
                  <input name="address" required className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 outline-none focus:border-emerald-700 transition-all" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1.5 ml-1">Tradição</label>
                  <select name="type" className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 outline-none focus:border-emerald-700 transition-all">
                    <option value="Umbanda">Umbanda</option>
                    <option value="Candomblé">Candomblé</option>
                    <option value="Misto">Misto</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1.5 ml-1">Sobre a Casa</label>
                  <textarea name="description" rows={3} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 outline-none focus:border-emerald-700 transition-all resize-none" />
                </div>
                <button 
                  type="submit"
                  className="w-full bg-emerald-700 text-white py-4 rounded-2xl font-bold hover:bg-emerald-800 transition-all shadow-lg shadow-emerald-700/20 mt-4"
                >
                  Cadastrar Agora
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
