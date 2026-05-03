import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/hooks/use-language";
import { AuthProvider } from "@/hooks/use-auth";
import { LanguageSelector } from "@/components/language-selector";
// import { InstructionGuide } from "@/components/instruction-guide";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import AdminPage from "@/pages/admin";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/admin" component={AdminPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // First-visit instruction guide disabled for production.
  // const [showGuide, setShowGuide] = useState(false);

  // useEffect(() => {
  //   const hasSeenGuide = localStorage.getItem("has-seen-guide");
  //   if (!hasSeenGuide) {
  //     setShowGuide(true);
  //   }
  // }, []);

  // const handleGuideComplete = () => {
  //   localStorage.setItem("has-seen-guide", "true");
  //   setShowGuide(false);
  // };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LanguageProvider>
          <AuthProvider>
            {/* {showGuide ? <InstructionGuide onComplete={handleGuideComplete} /> : null} */}
            <LanguageSelector />
            <Toaster />
            <Router />
          </AuthProvider>
        </LanguageProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
