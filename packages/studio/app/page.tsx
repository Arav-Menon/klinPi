import Navbar from "./components/landing/navbar";
import Hero from "./components/landing/hero";
import Workflow from "./components/landing/workflow";
import RepositorySection from "./components/landing/repository-section";
import SandboxSection from "./components/landing/sandbox-section";
import ActivitySection from "./components/landing/activity-section";
import Features from "./components/landing/features";
import Cta from "./components/landing/cta";
import Footer from "./components/landing/footer";
import SmoothEffects from "./components/landing/smooth-effects";

export default function Home() {
  return (
    <>
      <Navbar />
      <main id="main">
        <Hero />
        <Workflow />
        <RepositorySection />
        <SandboxSection />
        <ActivitySection />
        <Features />
        <Cta />
      </main>
      <Footer />
      <SmoothEffects />
    </>
  );
}
