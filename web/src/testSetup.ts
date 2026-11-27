import { configure } from "@testing-library/react";

// CI runners are slower than a laptop, and some tests wait for two chained mutations and a refetch.
// The default one-second limit for waitFor and findBy made those fail there while passing locally.
configure({ asyncUtilTimeout: 5000 });
