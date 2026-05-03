import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { ChevronRight, ChevronLeft, Check, AlertCircle, Info, ExternalLink } from "lucide-react";
import guideImage1 from "@/assets/stock_images/guide_1.png";
import guideImage2 from "@/assets/stock_images/guide_2.png";

export function InstructionGuide({ onComplete }) {
  const { t } = useLanguage();
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: t.guide.welcome,
      subtitle: t.guide.welcomeSubtitle,
      content: [],
      image: guideImage1,
      type: "intro"
    },
    {
      title: t.guide.instructions || "Instructions",
      sections: [
        {
          title: t.guide.partATitle,
          content: [
            t.guide.partAStep1,
            t.guide.partAStep2,
            t.guide.partAStep3,
            t.guide.partAStep4
          ]
        },
        {
          title: t.guide.partBTitle,
          content: [
            t.guide.partBStep1,
            t.guide.partBStep2,
            t.guide.partBStep3,
            t.guide.partBStep4
          ]
        }
      ],
      image: guideImage2,
      type: "multi-steps"
    },
    {
      title: t.guide.troubleshootingTitle,
      content: [
        t.guide.troubleshootingMethod1,
        t.guide.troubleshootingMethod2,
        t.guide.troubleshootingFooter
      ],
      image: guideImage2,
      type: "troubleshoot"
    }
  ];

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const formatText = (text) => {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+|netflix-code-finder\.vercel\.app)/g;
    const parts = text.split(urlRegex);
    
    return parts.map((part, index) => {
      if (part && part.match(urlRegex)) {
        const url = part.startsWith('http') ? part : `https://${part}`;
        return (
          <a
            key={index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-red-500 hover:text-red-400 font-bold underline decoration-red-500/30 underline-offset-4 transition-all hover:decoration-red-500 cursor-pointer relative z-[110]"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(url, '_blank', 'noopener,noreferrer');
            }}
          >
            {part.match(/netflix-code-finder\.vercel\.app/) ? "Click next" : part.replace(/^https?:\/\//, '')}
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </a>
        );
      }
      return part;
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-md p-2 sm:p-4 overflow-hidden">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-5xl h-full max-h-[90vh] flex flex-col shadow-2xl"
      >
        <Card className="overflow-hidden border-none bg-card/95 flex-1 flex flex-col">
          <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
            <div className="relative w-full bg-neutral-900 flex items-center justify-center overflow-hidden min-h-[250px] sm:min-h-[300px] md:min-h-[400px] border-b border-border/50">
              <AnimatePresence mode="wait">
                <motion.img
                  key={step}
                  src={steps[step].image}
                  alt={steps[step].title}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                  className="w-full h-full object-contain p-4 md:p-8"
                />
              </AnimatePresence>
              <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5 z-10">
                {steps.map((_, i) => (
                  <div 
                    key={i} 
                    className={`h-1 rounded-full transition-all duration-300 ${i === step ? 'w-8 bg-primary' : 'w-2 bg-white/20'}`}
                  />
                ))}
              </div>
            </div>
            
            <div className="w-full p-4 sm:p-6 md:p-10 flex flex-col bg-card overflow-hidden">
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="w-full"
                >
                  <h2 className="text-lg md:text-2xl font-bold mb-4 text-primary leading-tight uppercase tracking-wide">
                    {steps[step].title}
                  </h2>
                  
                  {steps[step].subtitle && (
                    <div className="mb-6 text-xs md:text-base italic border-l-4 border-primary/30 pl-4 py-2 bg-primary/5 rounded-r">
                      <p className="text-muted-foreground">{formatText(steps[step].subtitle)}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    {steps[step].type === "multi-steps" ? (
                      steps[step].sections.map((section, idx) => (
                        <div key={idx} className="space-y-3">
                          <h3 className="text-sm font-bold text-foreground border-b border-border pb-1 min-h-[21px]">
                            {section.title}
                          </h3>
                          <div className="space-y-3">
                            {section.content.map((text, i) => (
                              <div key={i} className="flex gap-3 items-start">
                                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                                  {i + 1}
                                </div>
                                <div className="flex-1">
                                  <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                                    {formatText(text)}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      steps[step].content.map((text, i) => (
                        <div key={i} className="flex gap-3 items-start bg-neutral-900/40 p-3 rounded border border-neutral-800/50">
                          {steps[step].type === "troubleshoot" ? (
                            <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                          ) : (
                            <Info className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1">
                            <div className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                              {formatText(text)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              </div>
              
              <div className="flex items-center justify-between pt-4 mt-4 border-t border-border/50">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  disabled={step === 0}
                  className="gap-1.5 text-xs text-muted-foreground hover:text-foreground h-8"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  {t.guide.back || "Back"}
                </Button>
                
                <Button
                  size="sm"
                  onClick={handleNext}
                  className="gap-1.5 min-w-[100px] shadow-lg shadow-primary/20 h-8 text-xs font-bold"
                >
                  {step === steps.length - 1 ? (
                    <>
                      {t.guide.gotIt}
                      <Check className="w-3.5 h-3.5" />
                    </>
                  ) : (
                    <>
                      {t.guide.next || "Next"}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
      <style jsx="true">{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: hsl(var(--muted-foreground) / 0.3);
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}