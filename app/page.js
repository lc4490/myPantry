"use client";

// base imports
import {
  auth,
  firestore,
  provider,
  signInWithPopup,
  signOut,
} from "@/firebase";
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Divider,
  Grid,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Modal,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Zoom,
} from "@mui/material";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";

// search icon
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import SearchIcon from "@mui/icons-material/Search";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import InputAdornment from "@mui/material/InputAdornment";
import LogoutIcon from "@mui/icons-material/Logout";
import AddIcon from "@mui/icons-material/Add";
import PersonIcon from "@mui/icons-material/Person";

// use image and camera
import Image from "next/image";
// import { Camera, switchCamera } from 'react-camera-pro';
import Webcam from "react-webcam";

// use openai
// const openaiApiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
// import { OpenAI } from "openai";

// use googlesignin
import { onAuthStateChanged } from "firebase/auth";

// theme imports
import { startCheckout } from "@/lib/upgrade";
import {
  createTheme,
  CssBaseline,
  ThemeProvider,
  useMediaQuery,
} from "@mui/material";

const lightTheme = createTheme({
  palette: {
    mode: "light",
    background: {
      default: "#ffffff",
      paper: "#ffffff",
      gray: "lightgray",
      banner: "banner.png",
    },
    text: {
      primary: "#000000",
    },
  },
});

const darkTheme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: "#121212",
      paper: "#121212",
      gray: "darkgray",
      banner: "banner.png",
    },
    text: {
      primary: "#ffffff",
    },
  },
});

export default function Home() {
  // declare
  // ----------------------------------------------------------------
  // Auth / mode
  // ----------------------------------------------------------------
  const [user, setUser] = useState(null);
  const [guestMode, setGuestMode] = useState(false);
  const [userMeta, setUserMeta] = useState({
    isPremium: false,
    tier: null,
    freeGenerationsLeft: 0,
  });
  const [bigLoading, setBigloading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setBigloading(true);
      if (u) {
        setUser(u);
        setGuestMode(false);
        updatePantry();
        updateRecipe();
        await refreshUserMeta();
      } else {
        setUser(null);
        setGuestMode(true);
        setPantry([]);
        setRecipes([]);
        setUserMeta({ isPremium: false, freeGenerationsLeft: 0 });
      }
      setBigloading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      console.log("User signed in:", result.user);
      await ensureUserDoc();
      setGuestMode(false);
    } catch (error) {
      console.error("Error signing in:", error);
      alert("Sign in failed: " + error.message);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      console.log("User signed out");
      setGuestMode(true);
      setPantry([]);
      setRecipes([]);
    } catch (error) {
      console.error("Error signing out:", error);
      alert("Sign out failed: " + error.message);
    }
  };

  // firebase
  function userEmailKey() {
    const email = auth.currentUser?.email || "";
    return email.trim().toLowerCase();
  }

  function userDocRef() {
    const key = userEmailKey();
    if (!key) throw new Error("No signed-in user email");
    return doc(firestore, "users", key); // users/{email}
  }

  function pantryColRef() {
    return collection(userDocRef(), "pantry"); // users/{email}/pantry
  }

  function recipesColRef() {
    return collection(userDocRef(), "recipes"); // users/{email}/recipes
  }

  function recipeDocId(r) {
    return String(r.recipe || "untitled")
      .toLowerCase()
      .replace(/\s+/g, "_");
  }

  const ensureUserDoc = async () => {
    const email = (auth.currentUser?.email || "").toLowerCase();
    if (!email) return;

    const ref = doc(firestore, "users", email);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // create with starting value
      await setDoc(ref, {
        freeGenerationsLeft: 3,
        isPremium: false,
        createdAt: new Date().toISOString(),
      });
    }
  };

  async function refreshUserMeta() {
    const email = (auth.currentUser?.email || "").toLowerCase();
    if (!email) {
      setUserMeta({ isPremium: false, tier: null, freeGenerationsLeft: 0 });
      return;
    }

    // 1) read existing (for the counter)
    const ref = doc(firestore, "users", email);
    const snap = await getDoc(ref);
    const d = snap.data() || {};

    // 2) ask Stripe (server truth)
    let isPremium = false;
    let tier = null;
    try {
      const res = await fetch("/api/stripe/is-premium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const data = await res.json();
        isPremium = !!data.isPremium;
        tier = data.tier || null; // "starter" | "pro" | null
      }
    } catch (e) {
      console.warn("[refreshUserMeta] premium check failed:", e?.message);
    }

    // 3) mirror to Firestore (optional but handy for admin/analytics/UI)
    try {
      await setDoc(
        ref,
        {
          isPremium,
          tier, // "starter" | "pro" | null
          stripeLastCheckedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("[refreshUserMeta] mirror write failed:", e?.message);
    }

    // 4) update local UI state
    setUserMeta({
      isPremium,
      tier,
      freeGenerationsLeft: Number(d.freeGenerationsLeft ?? 0),
    });
  }

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("upgrade") === "success") {
        refreshUserMeta();
      }
    } catch {}
  }, []);

  // ----------------------------------------------------------------
  // Pantry / recipes
  // ----------------------------------------------------------------
  const [pantry, setPantry] = useState([]); // [{ name, count, image? }]
  const [recipes, setRecipes] = useState([]); // [{ recipe, ingredients, instructions, image }]
  const [loading, setLoading] = useState(false);

  const updatePantry = async () => {
    if (!auth.currentUser) return;
    const userUID = auth.currentUser.uid;
    const snapshot = query(pantryColRef());
    const docsSnap = await getDocs(snapshot);
    const list = [];
    docsSnap.forEach((d) => list.push({ name: d.id, ...d.data() }));
    setPantry(list);
  };

  const updateRecipe = async () => {
    if (!auth.currentUser) return;
    const userUID = auth.currentUser.uid;
    const snapshot = query(recipesColRef());
    const docsSnap = await getDocs(snapshot);
    const list = [];
    docsSnap.forEach((d) => list.push({ name: d.id, ...d.data() }));
    setRecipes(list);
  };

  // ----------------------------------------------------------------
  // UI state
  // ----------------------------------------------------------------
  const [openAdd, setOpenAdd] = useState(false);

  const [openRecipeModal, setOpenRecipeModal] = useState(false);
  const [selectedRecipeIndex, setSelectedRecipeIndex] = useState(null); // number|null

  const [searchTerm, setSearchTerm] = useState("");
  const [recipeSearchTerm, setRecipeSearchTerm] = useState("");

  const [isFocused, setIsFocused] = useState(false);
  const [isFocusedRecipe, setIsFocusedRecipe] = useState(false);

  // Add modal inputs
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState(1); // number
  const [image, setImage] = useState(null);

  // Camera
  const [cameraOpen, setCameraOpen] = useState(false);
  const webcamRef = useRef(null);
  const [facingMode, setFacingMode] = useState("user"); // 'user' | 'environment'

  const handleOpenAdd = () => {
    clearFields();
    setOpenAdd(true);
  };
  const handleCloseAdd = () => {
    clearFields();
    setOpenAdd(false);
  };
  const handleOpenAddAndOpenCamera = () => {
    handleOpenAdd();
    setCameraOpen(true);
  };

  const clearFields = () => {
    setItemName("");
    setQuantity(1);
    setImage(null);
  };

  const [makeAccountMsg, setMakeAccountMsg] = useState(false);
  const [accountMsg, setAccountMsg] = useState("");

  // ----------------------------------------------------------------
  // AI (kept client-side per your current code; move to API routes later)
  // ----------------------------------------------------------------

  async function predictItem(imgDataUrl) {
    if (!imgDataUrl) return "";
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imgDataUrl }),
    });

    const response = await res.json();
    let result = response.result;
    result = result.replace(/\./g, "");
    result = result
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return result;
  }

  async function createImage(label) {
    const res = await fetch("/api/createImage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    return data?.dataUrl || null;
  }

  async function craftRecipes(pantryList) {
    if (!pantryList?.length) return [];

    const email = (auth.currentUser?.email || "").toLowerCase();
    if (!email) {
      alert("Please sign in to generate recipes.");
      return [];
    }

    const userRef = doc(firestore, "users", email);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const data = snap.data();
      if (!data.isPremium) {
        const left = data.freeGenerationsLeft ?? 0;
        if (left <= 0) {
          alert(
            "You’ve used all 3 free generations. Upgrade to Premium for unlimited ✨"
          );
          return [];
        }
        // subtract 1
        await updateDoc(userRef, {
          freeGenerationsLeft: left - 1,
        });
        setUserMeta((prev) => ({
          ...prev,
          freeGenerationsLeft: Math.max(
            0,
            (prev.freeGenerationsLeft ?? left) - 1
          ),
        }));
      }
    }
    const ingredientsCsv = pantryList.map((i) => i.name).join(", ");
    const res = await fetch("/api/makeRecipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredientsCsv }),
    });

    const response = await res.json();
    let result = response.result;
    console.log(response);
    console.log(result);

    const blocks = (result || "").trim().split("\n\n");
    const parsed = blocks
      .map((block) => {
        const lines = block.split("\n");
        const rx = (label) => {
          const row = lines.find((l) => l.toLowerCase().startsWith(label));
          return row
            ? row.split(": ").slice(1).join(": ").replace(/\*/g, "").trim()
            : "";
        };
        const recipe = rx("recipe");
        const ingredients = rx("ingredients");
        const instructions = rx("instructions");
        if (!recipe || !ingredients || !instructions) return null;
        return { recipe, ingredients, instructions };
      })
      .filter(Boolean);

    // Attach images in parallel (best-effort)
    // const withImages = await Promise.all(
    //   parsed.map(async (r) => {
    //     try {
    //       const img = await createImage(r.recipe);
    //       return { ...r, ...(img ? { image: img } : {}) };
    //     } catch (err) {
    //       console.warn("Image generation failed for", r.recipe, err);
    //       return r; // just return recipe without image
    //     }
    //   })
    // );
    return parsed;
  }

  // ----------------------------------------------------------------
  // Camera helpers
  // ----------------------------------------------------------------
  const captureImage = () => {
    const shot = webcamRef.current?.getScreenshot?.();
    if (!shot) return;
    setImage(shot);
    predictItem(shot).then(setItemName);
    setCameraOpen(false);
  };

  const switchCamera = () => {
    setFacingMode((m) => (m === "user" ? "environment" : "user"));
  };

  // ----------------------------------------------------------------
  // Pantry mutations
  // ----------------------------------------------------------------
  const addItem = async (item, qty, img) => {
    const n = Number(qty);
    if (!item || !Number.isFinite(n) || n <= 0) return;

    if (guestMode || !auth.currentUser) {
      setPantry((prev) => {
        const existing = prev.find(
          (p) => p.name.toLowerCase() === item.toLowerCase()
        );
        if (existing) {
          return prev.map((p) =>
            p.name.toLowerCase() === item.toLowerCase()
              ? { ...p, count: p.count + n, image: img || p.image || null }
              : p
          );
        }
        return [...prev, { name: item, count: n, image: img || null }];
      });
      return;
    }

    const userUID = auth.currentUser.uid;
    const ref = doc(pantryColRef(), item.toLowerCase());
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const { count = 0, image: existingImage = null } = snap.data() || {};
      await setDoc(ref, { count: count + n, image: img || existingImage });
    } else {
      await setDoc(ref, { count: n, image: img || null });
    }
    await updatePantry();
  };

  const handleQuantityChange = async (item, qty) => {
    const n = Math.max(0, Number(qty) || 0);

    if (guestMode || !auth.currentUser) {
      setPantry((prev) =>
        n === 0
          ? prev.filter((p) => p.name !== item) // remove if zero
          : prev.map((p) => (p.name === item ? { ...p, count: n } : p))
      );
      return;
    }

    const userUID = auth.currentUser.uid;
    const ref = doc(pantryColRef(), item);
    if (n === 0) {
      await deleteDoc(ref);
    } else {
      const snap = await getDoc(ref);
      const existingImage = (snap.data() || {}).image;
      await setDoc(ref, {
        count: n,
        ...(existingImage ? { image: existingImage } : {}),
      });
    }
    await updatePantry();
  };

  // Recipe mutations
  const addRecipes = async (recipes) => {
    console.log("add recipes");
    if (!auth.currentUser) return;
    const userUID = auth.currentUser.uid;
    const base = recipesColRef();

    // Save each recipe as a document under recipes_${uid}
    await Promise.all(
      recipes.map((r) => {
        // Use recipe name as doc id (lowercased, safe string)
        const docId = (r.recipe || "untitled")
          .toLowerCase()
          .replace(/\s+/g, "_");

        return setDoc(doc(base, docId), {
          recipe: r.recipe,
          ingredients: r.ingredients,
          instructions: r.instructions,
          image: r.image ?? null,
          createdAt: new Date(),
        });
      })
    );
    await updateRecipe();
  };

  const deleteRecipe = async (recipe) => {
    const email = (auth.currentUser?.email || "").toLowerCase().trim();
    const recipeId = recipeDocId(recipe);
    if (!email) {
      throw new Error("No signed-in user");
    }
    setBigloading(true);

    try {
      const ref = doc(firestore, "users", email, "recipes", recipeId);
      await deleteDoc(ref);
      console.log(`Recipe ${recipeId} deleted successfully`);
    } catch (err) {
      console.error("Error deleting recipe:", err);
      throw err;
    }
    setBigloading(false);
  };

  async function saveRecipeImageToFirestore(recipeKey, dataUrl) {
    const email = userEmailKey();
    if (!email) return;
    const ref = doc(firestore, "users", email, "recipes", recipeKey);
    await setDoc(
      ref,
      { image: dataUrl, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  }

  // ----------------------------------------------------------------
  // Derived state (memoized)
  // ----------------------------------------------------------------
  const filteredPantry = useMemo(
    () =>
      pantry.filter(({ name }) =>
        name.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [pantry, searchTerm]
  );

  const filteredRecipes = useMemo(
    () =>
      recipes?.filter((r) =>
        (r.recipe || r.title || "")
          .toLowerCase()
          .includes(recipeSearchTerm.toLowerCase())
      ),
    [recipes, recipeSearchTerm]
  );

  // ----------------------------------------------------------------
  // Effects: generate recipes whenever pantry contents change (name:count signature)
  // ----------------------------------------------------------------
  // assumes each recipe has either a stable `id` or a unique `recipe` name
  useEffect(() => {
    const run = async () => {
      const missing = recipes.filter((r) => r.image === null);
      if (missing && missing.length > 0) {
        const recipe = missing[0]?.recipe;
        const key = recipeDocId(missing[0]);
        console.log(recipe);
        console.log(key);

        if (recipe) {
          const img = await createImage(recipe);
          const dataUrl = img && img.startsWith("data:image/") ? img : null;
          if (dataUrl) {
            // set the final image
            setRecipes((prev) =>
              prev.map((p) =>
                recipeDocId(p) === key ? { ...p, image: dataUrl } : p
              )
            );
            try {
              await saveRecipeImageToFirestore(key, dataUrl);
              // or: await saveRecipeImageViaStorage(key, dataUrl);
            } catch (e) {
              console.warn("Persist failed for", key, e);
            }
          }
        }
      }
    };

    run();
  }, [recipes]);

  // Premium mode
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  const handleClick = async (e) => {
    if (userMeta?.isPremium) {
      setAnchorEl(e.currentTarget); // already premium -> open menu
      return;
    }

    // Not premium -> start upgrade flow
    if (!auth.currentUser?.email) {
      // your UI already shows a tooltip—this is a simple fallback
      alert("Please sign in to upgrade.");
      return;
    }

    try {
      setUpgradeLoading(true);
      const email = auth.currentUser.email.toLowerCase();
      await startCheckout(email);
    } catch (err) {
      console.error(err);
      alert(err?.message || "Upgrade failed");
    } finally {
      setUpgradeLoading(false);
    }
  };

  const handleSelect = async (plan) => {
    if (!auth.currentUser?.email) {
      handleSignIn();
      handleClose?.(); // close any menu/dialog
      return;
    }
    try {
      setUpgradeLoading(true);
      const email = auth.currentUser.email.toLowerCase();
      await startCheckout(email, plan);
    } catch (err) {
      console.error(err);
      alert(err?.message || "Upgrade failed");
    } finally {
      setUpgradeLoading(false);
    }
  };

  const handleClose = () => setAnchorEl(null);

  const [cancelLoading, setCancelLoading] = useState(false);

  const handleCancel = async () => {
    if (cancelLoading) return;

    const email = auth.currentUser?.email?.toLowerCase();
    if (!email) {
      alert("Please sign in to manage your membership.");
      return;
    }
    if (!userMeta?.isPremium) {
      alert("No active Premium membership found on your account.");
      return;
    }

    // (Optional) re-check server truth to avoid stale UI
    try {
      const res = await fetch("/api/stripe/is-premium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const { isPremium } = await res.json();
        if (!isPremium) {
          alert("Your membership is already inactive.");
          return;
        }
      }
    } catch {}

    try {
      setCancelLoading(true);
      handleClose?.(); // close any menu/dialog
      window.location.href = process.env.NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL; // redirect to Stripe portal login
    } finally {
      setCancelLoading(false);
    }
  };

  // ----------------------------------------------------------------
  // UI helpers
  // ----------------------------------------------------------------
  const truncateString = (str, num) =>
    str.length <= num ? str : str.slice(0, num) + "...";

  const handleRecipeModal = (index) => {
    setSelectedRecipeIndex(index);
    setOpenRecipeModal(true);
  };

  // toggle dark mode
  // Detect user's preferred color scheme
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const [darkMode, setDarkMode] = useState(prefersDarkMode);

  // Update dark mode state when the user's preference changes
  useEffect(() => {
    setDarkMode(prefersDarkMode);
  }, [prefersDarkMode]);

  const theme = darkMode ? darkTheme : lightTheme;
  if (bigLoading) {
    return (
      <Box
        width="100vw"
        height="100vh"
        bgcolor="#000"
        display="flex"
        justifyContent={"center"}
        alignItems={"center"}
      >
        <CircularProgress />
      </Box>
    );
  }
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Page wrapper */}
      <Box
        sx={{
          minHeight: "100vh",
          bgcolor: "background.default",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Sticky header */}
        <Box
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 1200,
            bgcolor: "background.default",
            borderBottom: (t) => `1px solid ${t.palette.divider}`,
            px: { xs: 1.5, md: 3 },
          }}
        >
          <Box
            sx={{
              height: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1.5,
            }}
          >
            <Button
              // variant="outlined"
              onClick={handleOpenAddAndOpenCamera}
              sx={{
                color: "text.primary",
              }}
              aria-label="Add pantry item"
            >
              <AddIcon />
            </Button>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography
                variant="h6"
                color="text.primary"
                sx={{ fontWeight: 700 }}
              >
                myPantry
              </Typography>
              <Button
                variant="contained"
                disabled={upgradeLoading}
                onClick={(e) => setAnchorEl(e.currentTarget)}
                sx={{
                  height: 32,
                  borderRadius: 1,
                  px: 1.25,
                  py: 0.5,
                  bgcolor: "text.primary",
                  color: "background.default",
                  fontWeight: 700,
                  textTransform: "none",
                  "&:hover": { opacity: 0.9 },
                }}
              >
                {userMeta.tier ? userMeta.tier.toUpperCase() : "UPGRADE"}
              </Button>

              {/* Premium/Upgrade menus (unchanged) */}
              {userMeta.isPremium ? (
                <Menu
                  anchorEl={anchorEl}
                  open={open}
                  onClose={handleClose}
                  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                  transformOrigin={{ vertical: "top", horizontal: "right" }}
                >
                  <MenuItem
                    onClick={handleCancel}
                    disabled={cancelLoading || !auth.currentUser?.email}
                    sx={{
                      color: "primary.main",
                      fontWeight: 600,
                      "&:hover": { bgcolor: "primary.light", color: "white" },
                    }}
                  >
                    <ListItemIcon>
                      <ManageAccountsIcon
                        fontSize="small"
                        sx={{ color: "inherit" }}
                      />
                    </ListItemIcon>
                    <ListItemText primary="Manage Subscription" />
                  </MenuItem>
                </Menu>
              ) : (
                <Menu
                  anchorEl={anchorEl}
                  open={open}
                  onClose={handleClose}
                  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                  transformOrigin={{ vertical: "top", horizontal: "right" }}
                >
                  <MenuItem
                    onClick={() => handleSelect("starter")}
                    sx={{
                      fontWeight: 600,
                      borderRadius: 2,
                      mb: 1,
                      "&:hover": { bgcolor: "#3b82f6", color: "white" },
                    }}
                  >
                    <ListItemIcon>
                      <StarBorderIcon
                        fontSize="small"
                        sx={{ color: "#3b82f6" }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary="Starter — $6.99/mo"
                      primaryTypographyProps={{ fontWeight: 600 }}
                    />
                  </MenuItem>
                  <MenuItem
                    onClick={() => handleSelect("pro")}
                    sx={{
                      fontWeight: 600,
                      borderRadius: 2,
                      "&:hover": { bgcolor: "#a855f7", color: "white" },
                    }}
                  >
                    <ListItemIcon>
                      <WorkspacePremiumIcon
                        fontSize="small"
                        sx={{ color: "#a855f7" }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary="Pro — $9.99/mo"
                      primaryTypographyProps={{ fontWeight: 600 }}
                    />
                  </MenuItem>
                </Menu>
              )}
            </Box>

            <Box>
              {!user ? (
                <Button
                  onClick={handleSignIn}
                  sx={{ textTransform: "none", color: "text.primary" }}
                >
                  Sign In
                </Button>
              ) : (
                <Button
                  onClick={handleSignOut}
                  sx={{ textTransform: "none", color: "text.primary" }}
                >
                  <LogoutIcon />
                </Button>
              )}
            </Box>
          </Box>
        </Box>

        {/* Banner */}
        <Box sx={{ width: "100%", overflow: "hidden" }}>
          <Image
            src={"/banner.png"}
            alt="banner"
            width={1920}
            height={480}
            style={{ width: "100%", height: "auto" }}
          />
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, px: { xs: 1.5, md: 3 }, py: 3 }}>
          {/* Recipes Section */}
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              alignItems: { xs: "stretch", md: "center" },
              justifyContent: "space-between",
              // backgroundColor: "red",
              gap: 2,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Typography variant="h4" fontWeight={800}>
                Recipes
              </Typography>
              {loading ? (
                <CircularProgress size={24} />
              ) : (
                <Button
                  variant="contained"
                  disabled={loading}
                  onClick={async () => {
                    if (!user) {
                      setMakeAccountMsg(true);
                      setAccountMsg("Sign in to generate recipes");
                      setTimeout(() => setMakeAccountMsg(false), 2500);
                      return;
                    }
                    if (pantry.length === 0) {
                      setMakeAccountMsg(true);
                      setAccountMsg("Add items to pantry first");
                      setTimeout(() => setMakeAccountMsg(false), 2500);
                      return;
                    }
                    setLoading(true);
                    try {
                      const out = await craftRecipes(pantry);
                      setRecipes(out);
                      await addRecipes(out);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  sx={{
                    borderRadius: 1.25,
                    textTransform: "none",
                    fontWeight: 700,
                    background: "linear-gradient(90deg, #6b7280, #9ca3af)",
                    "&:hover": {
                      background: "linear-gradient(90deg, #4b5563, #6b7280)",
                    },
                  }}
                >
                  <Tooltip
                    open={makeAccountMsg}
                    title={
                      <Box sx={{ p: 1 }}>
                        <Typography variant="body1" fontWeight={500}>
                          {accountMsg}
                        </Typography>
                      </Box>
                    }
                    placement="top"
                    arrow
                  >
                    {userMeta.isPremium || !user
                      ? "GENERATE"
                      : `GENERATE [${userMeta.freeGenerationsLeft}/3]`}
                  </Tooltip>
                </Button>
              )}
            </Box>

            {/* Recipes search */}
            <Autocomplete
              freeSolo
              disableClearable
              options={recipes?.map((o) => o.recipe)}
              onInputChange={(_, v) => setRecipeSearchTerm(v)}
              ListboxProps={{
                component: "div",
                sx: { bgcolor: "background.default", color: "text.primary" },
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder="Search recipes..."
                  onFocus={() => setIsFocusedRecipe(true)}
                  onBlur={() => setIsFocusedRecipe(false)}
                  sx={{
                    ml: { xs: 0, md: "auto" },
                    width: isFocusedRecipe
                      ? { xs: "100%", md: "28ch" }
                      : {
                          xs: "100%",
                          md: `${Math.max(recipeSearchTerm.length, 0) + 10}ch`,
                        },
                    transition: "width 0.25s",
                    "& .MuiOutlinedInput-root": {
                      "& fieldset": { borderColor: "divider" },
                      "&:hover fieldset": { borderColor: "text.primary" },
                    },
                  }}
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ color: "text.primary" }} />
                      </InputAdornment>
                    ),
                  }}
                />
              )}
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Recipes carousel/grid */}
          <Stack
            direction="row"
            alignItems="flex-start"
            sx={{ overflowX: "auto", px: 0.5 }}
          >
            {filteredRecipes?.map(({ recipe, image }, index) => (
              <Button
                key={index}
                onClick={() => handleRecipeModal(index)}
                sx={{ color: "text.primary", flexShrink: 0, mr: 2 }}
              >
                <Box
                  sx={{
                    width: 275,
                    p: 1,
                    borderRadius: 2,
                    boxShadow: 1,
                    bgcolor: "background.paper",
                  }}
                >
                  <Box
                    sx={{
                      width: "100%",
                      height: 200,
                      borderRadius: 1.5,
                      overflow: "hidden",
                      bgcolor: "action.hover",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {image ? (
                      <Image
                        src={image}
                        alt={recipe}
                        width={400}
                        height={300}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <CircularProgress size={24} />
                    )}
                  </Box>
                  <Typography
                    variant="subtitle1"
                    fontWeight={700}
                    sx={{ mt: 1, textAlign: "center" }}
                  >
                    {recipe &&
                      truncateString(
                        recipe.charAt(0).toUpperCase() + recipe.slice(1),
                        50
                      )}
                  </Typography>
                </Box>
              </Button>
            ))}
          </Stack>

          {/* Pantry Section */}
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              alignItems: { xs: "stretch", md: "center" },
              justifyContent: "space-between",
              gap: 2,
              mt: 4,
            }}
          >
            <Typography variant="h4" fontWeight={800}>
              In your Pantry
            </Typography>
            <Autocomplete
              freeSolo
              disableClearable
              options={pantry.map((o) => o.name)}
              onInputChange={(_, v) => setSearchTerm(v)}
              ListboxProps={{
                component: "div",
                sx: { bgcolor: "background.default", color: "text.primary" },
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder="Search pantry..."
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  sx={{
                    ml: { xs: 0, md: "auto" },
                    width: isFocused
                      ? { xs: "100%", md: "28ch" }
                      : {
                          xs: "100%",
                          md: `${Math.max(searchTerm.length, 0) + 10}ch`,
                        },
                    transition: "width 0.25s",
                    "& .MuiOutlinedInput-root": {
                      "& fieldset": { borderColor: "divider" },
                      "&:hover fieldset": { borderColor: "text.primary" },
                    },
                  }}
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ color: "text.primary" }} />
                      </InputAdornment>
                    ),
                  }}
                />
              )}
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Pantry grid */}
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <Grid
              container
              spacing={2}
              sx={{ width: { xs: 330, sm: 1365 }, px: 1 }}
            >
              {filteredPantry.map(({ name, count, image }, index) => (
                <Grid
                  key={index}
                  item
                  xs={12}
                  sm={6}
                  md={4}
                  display="flex"
                  justifyContent="center"
                >
                  <Box
                    sx={{
                      width: 325,
                      p: 2,
                      borderRadius: 2,
                      border: (t) => `1px solid ${t.palette.divider}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 2,
                      bgcolor: "background.paper",
                    }}
                  >
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {truncateString(
                          name.charAt(0).toUpperCase() + name.slice(1),
                          16
                        )}
                      </Typography>
                      <Stack
                        direction="row"
                        alignItems="center"
                        gap={1}
                        sx={{ mt: 1 }}
                      >
                        <Button
                          sx={{
                            minWidth: 36,
                            height: 28,
                            borderRadius: 999,
                            bgcolor: "action.hover",
                            "&:hover": { bgcolor: "action.selected" },
                          }}
                          onClick={() =>
                            handleQuantityChange(name, Math.max(0, count - 1))
                          }
                        >
                          -
                        </Button>
                        <TextField
                          value={parseInt(count)}
                          onChange={(e) =>
                            handleQuantityChange(
                              name,
                              parseInt(e.target.value) || 0
                            )
                          }
                          sx={{
                            width: 56,
                            "& .MuiOutlinedInput-root": {
                              "& fieldset": { borderColor: "divider" },
                            },
                          }}
                          inputProps={{ style: { textAlign: "center" } }}
                        />
                        <Button
                          sx={{
                            minWidth: 36,
                            height: 28,
                            borderRadius: 999,
                            bgcolor: "action.hover",
                            "&:hover": { bgcolor: "action.selected" },
                          }}
                          onClick={() => handleQuantityChange(name, count + 1)}
                        >
                          +
                        </Button>
                      </Stack>
                    </Box>
                    <Box
                      sx={{
                        width: 100,
                        height: 100,
                        borderRadius: 1.5,
                        overflow: "hidden",
                        bgcolor: "action.hover",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {image ? (
                        <Image
                          src={image}
                          alt={name}
                          width={100}
                          height={100}
                          style={{ objectFit: "cover" }}
                        />
                      ) : (
                        <Image
                          src="/ingredients.jpg"
                          alt={name}
                          width={100}
                          height={100}
                          style={{ objectFit: "cover" }}
                        />
                      )}
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Box>

        {/* ADD ITEM MODAL (same logic; tighter styles) */}
        <Modal open={openAdd} onClose={handleCloseAdd}>
          <Box
            sx={{
              position: "absolute",
              top: "8%",
              left: "50%",
              transform: "translateX(-50%)",
              width: { xs: "92%", sm: 520 },
              maxHeight: "84vh",
              overflow: "auto",
              bgcolor: "background.paper",
              color: "text.primary",
              borderRadius: 2,
              border: (t) => `1px solid ${t.palette.divider}`,
              boxShadow: 24,
              p: 2,
            }}
          >
            {image ? (
              <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
                <Image
                  src={image}
                  alt="Captured"
                  width={320}
                  height={320}
                  style={{ borderRadius: 12, objectFit: "cover" }}
                />
              </Box>
            ) : (
              <Stack
                direction="row"
                gap={1}
                justifyContent="center"
                sx={{ mb: 2 }}
              >
                <Button variant="outlined" onClick={() => setCameraOpen(true)}>
                  Open Camera
                </Button>
                <Button variant="outlined" component="label">
                  Upload Photo
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const valid = [
                        "image/png",
                        "image/jpeg",
                        "image/gif",
                        "image/webp",
                      ];
                      if (!valid.includes(file.type)) {
                        alert("Please upload PNG/JPEG/GIF/WEBP");
                        return;
                      }
                      if (file.size > 20 * 1024 * 1024) {
                        alert("Image must be < 20MB");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        const dataUrl = reader.result;
                        setImage(dataUrl);
                        predictItem(dataUrl).then(setItemName);
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </Button>
              </Stack>
            )}

            <TextField
              fullWidth
              placeholder="Item name"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              sx={{
                mb: 2,
                "& .MuiOutlinedInput-root": {
                  fontWeight: 600,
                  fontSize: "1.25rem",
                },
              }}
            />

            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              gap={2}
            >
              <Stack direction="row" alignItems="center" gap={1}>
                <Button
                  onClick={() =>
                    setQuantity((prev) => Math.max(0, parseInt(prev) - 1))
                  }
                >
                  -
                </Button>
                <TextField
                  value={parseInt(quantity)}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                  sx={{ width: 72 }}
                  inputProps={{
                    style: { textAlign: "center", fontWeight: 700 },
                  }}
                />
                <Button
                  onClick={() => setQuantity((prev) => parseInt(prev) + 1)}
                >
                  +
                </Button>
              </Stack>

              <Button
                variant="contained"
                onClick={() => {
                  addItem(itemName, parseInt(quantity), image);
                  setItemName("");
                  setQuantity(1);
                  handleCloseAdd();
                }}
                sx={{ textTransform: "none", fontWeight: 700 }}
              >
                Add
              </Button>
            </Stack>
          </Box>
        </Modal>

        {/* CAMERA MODAL (centered) */}
        <Modal open={cameraOpen} onClose={() => setCameraOpen(false)}>
          <Box
            sx={{
              position: "fixed",
              inset: 0,
              bgcolor: "rgba(0,0,0,0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              p: 2,
            }}
          >
            <Box sx={{ width: 360, maxWidth: "92vw" }}>
              <Typography sx={{ color: "white", mb: 1, textAlign: "center" }}>
                Use the camera to identify items, or exit to enter manually.
              </Typography>
              <Box
                sx={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "1 / 1",
                  borderRadius: 2,
                  overflow: "hidden",
                  bgcolor: "black",
                }}
              >
                <Webcam
                  ref={webcamRef}
                  screenshotFormat="image/jpeg"
                  videoConstraints={{ facingMode }}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </Box>
              <Stack
                direction="row"
                gap={1.5}
                justifyContent="center"
                sx={{ mt: 2 }}
              >
                <Button variant="contained" onClick={captureImage}>
                  Take Photo
                </Button>
                <Button
                  onClick={() =>
                    setFacingMode((m) =>
                      m === "user" ? "environment" : "user"
                    )
                  }
                >
                  Switch Camera
                </Button>
                <Button variant="outlined" onClick={() => setCameraOpen(false)}>
                  Exit
                </Button>
              </Stack>
            </Box>
          </Box>
        </Modal>

        {/* RECIPE MODAL (image-first) */}
        <Modal open={openRecipeModal} onClose={() => setOpenRecipeModal(false)}>
          {loading ? (
            <Box
              sx={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                p: 2,
              }}
            >
              <CircularProgress />
            </Box>
          ) : (
            <Box
              sx={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: { xs: "92%", sm: 560 },
                maxHeight: "90vh",
                overflow: "auto",
                bgcolor: "background.paper",
                borderRadius: 2,
                boxShadow: 24,
                p: 2,
              }}
            >
              {selectedRecipeIndex !== null && recipes[selectedRecipeIndex] && (
                <>
                  <Box
                    sx={{
                      position: "relative",
                      width: "100%",
                      aspectRatio: "16/9",
                      borderRadius: 1.5,
                      overflow: "hidden",
                      bgcolor: "action.hover",
                    }}
                  >
                    {recipes[selectedRecipeIndex].image ? (
                      <Image
                        src={recipes[selectedRecipeIndex].image}
                        alt="recipe"
                        fill
                        style={{ objectFit: "cover" }}
                        sizes="(max-width: 600px) 100vw, 600px"
                      />
                    ) : (
                      <Box
                        sx={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <CircularProgress />
                      </Box>
                    )}
                  </Box>

                  <Typography variant="h6" fontWeight={800} sx={{ mt: 1.5 }}>
                    {recipes[selectedRecipeIndex].recipe}
                  </Typography>

                  {recipes[selectedRecipeIndex].ingredients && (
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: "pre-wrap", mt: 1 }}
                    >
                      <strong>Ingredients:</strong>{" "}
                      {recipes[selectedRecipeIndex].ingredients}
                    </Typography>
                  )}

                  {recipes[selectedRecipeIndex].instructions && (
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: "pre-wrap", mt: 1 }}
                    >
                      <strong>Instructions:</strong>{" "}
                      {recipes[selectedRecipeIndex].instructions}
                    </Typography>
                  )}

                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    sx={{ mt: 2 }}
                  >
                    <Button
                      variant="outlined"
                      onClick={() => setOpenRecipeModal(false)}
                      sx={{ textTransform: "none" }}
                    >
                      Close
                    </Button>
                    <Button
                      variant="contained"
                      color="error"
                      sx={{ textTransform: "none", fontWeight: 700 }}
                      onClick={async () => {
                        setOpenRecipeModal(false);
                        await deleteRecipe(recipes[selectedRecipeIndex]);
                        await updateRecipe();
                      }}
                    >
                      Delete
                    </Button>
                  </Stack>
                </>
              )}
            </Box>
          )}
        </Modal>
      </Box>
    </ThemeProvider>
  );
}
