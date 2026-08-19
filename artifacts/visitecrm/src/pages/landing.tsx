import { Link } from "wouter";
import { localToday } from "@workspace/shared";
import { Map, ArrowRight, ShieldCheck, Users, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-8 py-6 flex items-center justify-between border-b">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold">
            V
          </div>
          <span className="font-bold text-xl">VisiteCRM</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="text-sm font-medium hover:text-primary transition-colors">Sign In</Link>
          <Link href="/sign-up">
            <Button>Get Started</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-20">
        <div className="max-w-3xl mx-auto space-y-8">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground">
            The command center for your travel agency
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Manage clients, trips, reservations, and finances all in one powerful platform built specifically for group excursion agencies.
          </p>
          <div className="flex items-center justify-center gap-4 pt-4">
            <Link href="/sign-up">
              <Button size="lg" className="h-14 px-8 text-lg font-medium">
                Start for free <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="h-14 px-8 text-lg font-medium">
              Book a demo
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto mt-32 text-left">
          <div className="bg-card p-8 rounded-2xl border shadow-sm">
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-6 text-primary">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Client Management</h3>
            <p className="text-muted-foreground leading-relaxed">Keep track of your travelers, their preferences, and booking history in a centralized database.</p>
          </div>
          <div className="bg-card p-8 rounded-2xl border shadow-sm">
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-6 text-primary">
              <Map className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Trip Organization</h3>
            <p className="text-muted-foreground leading-relaxed">Plan itineraries, manage seat maps, and organize every detail of your excursions effortlessly.</p>
          </div>
          <div className="bg-card p-8 rounded-2xl border shadow-sm">
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-6 text-primary">
              <TrendingUp className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Financial Control</h3>
            <p className="text-muted-foreground leading-relaxed">Track payments, manage installments, and get a clear picture of your agency's financial health.</p>
          </div>
        </div>
      </main>

      <footer className="py-8 text-center text-sm text-muted-foreground border-t">
        <p>&copy; {Number(localToday().slice(0, 4))} VisiteCRM. All rights reserved.</p>
      </footer>
    </div>
  );
}
