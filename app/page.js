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
import SearchIcon from "@mui/icons-material/Search";
import InputAdornment from "@mui/material/InputAdornment";
import CancelIcon from "@mui/icons-material/Cancel";

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
import {
  createTheme,
  CssBaseline,
  ThemeProvider,
  useMediaQuery,
} from "@mui/material";
import { startCheckout } from "@/lib/upgrade";

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
    const email = userEmailKey();
    if (!email) {
      setUserMeta({ isPremium: false, freeGenerationsLeft: 0 });
      return;
    }

    // Read your existing doc (for the counter)
    const snap = await getDoc(doc(firestore, "users", email));
    const d = snap.data() || {};
    let premium = false;

    // Ask Stripe (server) for the truth
    try {
      const res = await fetch("/api/stripe/is-premium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) premium = !!data.isPremium;
    } catch (e) {
      console.warn("[refreshUserMeta] premium check failed:", e?.message);
    }

    // Optional: mirror into Firestore for convenience (client-side write)
    // (Only if your security rules allow users to update their own doc.)
    try {
      if (premium !== !!d.isPremium) {
        await setDoc(
          doc(firestore, "users", email),
          { isPremium: premium },
          { merge: true }
        );
      }
    } catch (e) {
      console.warn("[refreshUserMeta] mirror to Firestore failed:", e?.message);
    }

    setUserMeta({
      isPremium: premium,
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
    const ref = doc(pantryColRef(), item);
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
      <Box
        width="100vw"
        height="100vh"
        display="flex"
        justifyContent="center"
        alignItems="center"
        flexDirection="column"
        gap={2}
        bgcolor="background.default"
        fontFamily="sans-serif"
      >
        {/* add modal */}
        <Modal open={openAdd} onClose={handleCloseAdd}>
          <Box
            sx={{
              position: "absolute",
              top: "10%",
              width: "100%",
              height: "90%",
              bgcolor: "background.default",
              border: "2px solid #000",
              boxShadow: 24,
              p: 2,
              display: "flex",
              alignItems: "center",
              flexDirection: "column",
              gap: 3,
              color: "text.primary",
              borderColor: "text.primary",
              borderRadius: "15px",
            }}
          >
            {image && (
              <Box
                display="flex"
                justifyContent="center"
                width="100%"
                sx={{
                  borderRadius: "16px",
                  overflow: "hidden",
                }}
              >
                <Image
                  src={image}
                  alt={"Captured"}
                  width={300}
                  height={300}
                  style={{ borderRadius: "16px", objectFit: "cover" }}
                />
              </Box>
            )}
            {!image && (
              <>
                <Button
                  variant="outlined"
                  onClick={() => setCameraOpen(true)}
                  sx={{
                    color: "text.primary",
                    borderColor: "text.primary",
                    "&:hover": {
                      backgroundColor: "background.default",
                      color: "text.primary",
                      borderColor: "text.primary",
                    },
                  }}
                >
                  Open Camera
                </Button>
                {/* upload photo */}
                <Button
                  variant="outlined"
                  component="label"
                  sx={{
                    color: "text.primary",
                    borderColor: "text.primary",
                    "&:hover": {
                      backgroundColor: "background.default",
                      color: "text.primary",
                      borderColor: "text.primary",
                    },
                  }}
                >
                  Upload Photo
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) {
                        // Validate file type
                        const validTypes = [
                          "image/png",
                          "image/jpeg",
                          "image/gif",
                          "image/webp",
                        ];
                        if (!validTypes.includes(file.type)) {
                          alert(
                            "Unsupported image format. Please upload a PNG, JPEG, GIF, or WEBP file."
                          );
                          return;
                        }

                        // Validate file size
                        const maxSize = 20 * 1024 * 1024; // 20 MB in bytes
                        if (file.size > maxSize) {
                          alert(
                            "File is too large. Please upload an image smaller than 20 MB."
                          );
                          return;
                        }
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setImage(reader.result);
                          predictItem(reader.result).then(setItemName);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </Button>
              </>
            )}
            <Divider
              sx={{ width: "100%", backgroundColor: "background.default" }}
            />
            <Box width="100%" height="25%">
              <TextField
                label=""
                variant="outlined"
                fullWidth
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    color: "text.primary",
                    fontSize: "2.5rem",
                    fontWeight: "550",
                    "& fieldset": {
                      borderColor: "lightgray",
                    },
                    "&:hover fieldset": {
                      borderColor: "lightgray",
                    },
                    "&.Mui-focused fieldset": {
                      borderColor: "lightgray",
                    },
                  },
                  "& .MuiInputLabel-root": {
                    color: "text.primary",
                    fontSize: "2.5rem",
                    fontWeight: "550",
                  },
                }}
                InputProps={{
                  style: {
                    textAlign: "center",
                    fontSize: "1.5rem",
                  },
                }}
                InputLabelProps={{
                  style: {
                    color: "text.primary",
                    width: "100%",
                    fontSize: "1.5rem",
                  },
                }}
              />
            </Box>
            <Stack
              width="100%"
              direction="column"
              spacing={2}
              justifyContent="space-between"
            >
              <Stack
                width="100%"
                direction="row"
                justifyContent="end"
                alignItems="center"
              >
                <Button
                  sx={{
                    backgroundColor: "lightgray",
                    color: "black",
                    borderColor: "lightgray",
                    borderRadius: "50px",
                    height: "50px",
                    minWidth: "50px",
                    "&:hover": {
                      backgroundColor: "darkgray",
                      color: "text.primary",
                      borderColor: "text.primary",
                    },
                  }}
                  onClick={() =>
                    setQuantity((prev) => Math.max(0, parseInt(prev) - 1))
                  }
                >
                  -
                </Button>
                <TextField
                  label=""
                  variant="outlined"
                  value={parseInt(quantity)}
                  onChange={(e) => setQuantity(parseInt(e.target.value))}
                  sx={{
                    width: "50px",
                    "& .MuiOutlinedInput-root": {
                      color: "text.primary",
                      "& fieldset": {
                        borderColor: "background.default",
                      },
                      "&:hover fieldset": {
                        borderColor: "background.default",
                      },
                      "&.Mui-focused fieldset": {
                        borderColor: "lightgray",
                      },
                    },
                    "& .MuiInputLabel-root": {
                      color: "text.primary",
                    },
                  }}
                  InputLabelProps={{
                    style: { color: "text.primary", width: "100%" },
                  }}
                />
                <Button
                  sx={{
                    backgroundColor: "lightgray",
                    color: "black",
                    borderColor: "lightgray",
                    borderRadius: "50px",
                    height: "50px",
                    minWidth: "50px",
                    "&:hover": {
                      backgroundColor: "darkgray",
                      color: "text.primary",
                      borderColor: "text.primary",
                    },
                  }}
                  onClick={() => setQuantity((prev) => parseInt(prev) + 1)}
                >
                  +
                </Button>
              </Stack>
              <Button
                variant="outlined"
                onClick={() => {
                  addItem(itemName, parseInt(quantity), image);
                  setItemName("");
                  setQuantity(1);
                  handleCloseAdd();
                }}
                sx={{
                  backgroundColor: "text.primary",
                  color: "background.default",
                  borderColor: "text.primary",
                  "&:hover": {
                    backgroundColor: "darkgray",
                    color: "text.primary",
                    borderColor: "text.primary",
                  },
                }}
              >
                Add
              </Button>
            </Stack>
          </Box>
        </Modal>

        {/* camera modal */}
        <Modal open={cameraOpen} onClose={() => setCameraOpen(false)}>
          <Box width="100vw" height="100vh" backgroundColor="black">
            <Stack
              display="flex"
              justifyContent="center"
              alignItems="center"
              flexDirection="column"
              sx={{ transform: "translate(0%,25%)" }}
            >
              <Box
                sx={{
                  // position: 'absolute',
                  top: "50%",
                  bgcolor: "black",
                  width: 350,
                  height: 350,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingY: 2,
                  position: "relative",
                }}
              >
                <Typography>
                  Use the camera to identify items in your pantry, or click exit
                  to manually enter them in.
                </Typography>
                <Box
                  sx={{
                    // width: '50%', // This makes the width of the container 50% of its parent
                    maxWidth: 350, // Optional: Limit the maximum width
                    aspectRatio: "1/1", // Ensures the box is a square
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    position: "relative", // Allows the button to be positioned over the video feed
                    backgroundColor: "black", // Background color for the box
                    borderRadius: "16px", // Optional: adds rounded corners
                    overflow: "hidden", // Ensures the video doesn't overflow the container
                  }}
                >
                  <Webcam
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    videoConstraints={{
                      facingMode: facingMode,
                      // aspectRatio: 4/3,
                    }}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover", // Ensures the video covers the square without distortion
                    }}
                  />
                </Box>
              </Box>
              <Stack flexDirection="row" gap={2} position="relative">
                <Button
                  variant="outlined"
                  onClick={captureImage}
                  sx={{
                    color: "black",
                    borderColor: "white",
                    backgroundColor: "white",
                    "&:hover": {
                      backgroundColor: "white",
                      color: "black",
                      borderColor: "white",
                    },
                    marginTop: 1,
                  }}
                >
                  Take Photo
                </Button>
                <Button
                  onClick={switchCamera}
                  sx={{
                    color: "black",
                    borderColor: "white",
                    backgroundColor: "white",
                    "&:hover": {
                      backgroundColor: "white",
                      color: "black",
                      borderColor: "white",
                    },
                    marginTop: 1,
                  }}
                >
                  Switch Camera
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => {
                    setCameraOpen(false);
                  }}
                  sx={{
                    color: "black",
                    borderColor: "white",
                    backgroundColor: "white",
                    "&:hover": {
                      backgroundColor: "white",
                      color: "black",
                      borderColor: "white",
                    },
                    marginTop: 1,
                  }}
                >
                  Exit
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Modal>

        {/* recipe modal */}
        {/* recipe modal (simplified, drop-in) */}
        <Modal open={openRecipeModal} onClose={() => setOpenRecipeModal(false)}>
          {loading ? (
            <Box
              sx={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                backgroundColor: "black",
              }}
              width="600px"
              height="600px"
              display="flex"
              justifyContent={"center"}
              alignItems={"center"}
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
                width: { xs: "90vw", sm: 520 },
                maxHeight: "90vh",
                bgcolor: "background.default",
                borderRadius: 2,
                boxShadow: 24,
                p: 2,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                overflow: "auto",
              }}
            >
              {selectedRecipeIndex !== null && recipes[selectedRecipeIndex] && (
                <>
                  {/* Image banner */}
                  <Box
                    sx={{
                      position: "relative",
                      width: "100%",
                      aspectRatio: "16 / 9",
                      bgcolor: "action.hover",
                      borderRadius: 1,
                      overflow: "hidden",
                    }}
                  >
                    {recipes[selectedRecipeIndex].image ? (
                      <Image
                        src={recipes[selectedRecipeIndex].image}
                        alt="recipe"
                        fill
                        style={{ objectFit: "cover" }}
                        sizes="(max-width: 600px) 100vw, 600px"
                        priority
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

                  {/* Title */}
                  <Typography variant="h6" fontWeight={700}>
                    {recipes[selectedRecipeIndex].recipe}
                  </Typography>

                  {/* Ingredients */}
                  {recipes[selectedRecipeIndex].ingredients && (
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      <strong>Ingredients:</strong>{" "}
                      {recipes[selectedRecipeIndex].ingredients}
                    </Typography>
                  )}

                  {/* Instructions */}
                  {recipes[selectedRecipeIndex].instructions && (
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      <strong>Instructions:</strong>{" "}
                      {recipes[selectedRecipeIndex].instructions}
                    </Typography>
                  )}

                  {/* Actions */}
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 1,
                      pt: 1,
                    }}
                  >
                    <Button
                      variant="outlined"
                      onClick={() => setOpenRecipeModal(false)}
                      sx={{ borderRadius: 1.5, textTransform: "none", px: 2 }}
                    >
                      Close
                    </Button>

                    <Button
                      variant="contained"
                      color="error"
                      sx={{
                        borderRadius: 1.5,
                        textTransform: "none",
                        px: 2,
                        fontWeight: 600,
                      }}
                      onClick={async () => {
                        setOpenRecipeModal(false);
                        await deleteRecipe(recipes[selectedRecipeIndex]); // remove await if sync
                        await updateRecipe();
                      }}
                    >
                      Delete
                    </Button>
                  </Box>
                </>
              )}
            </Box>
          )}
        </Modal>

        {/* main page */}
        <Box width="100%" height="100%" bgcolor="background.default">
          {/* header including add button, title, sign in */}
          <Box
            height="10%"
            bgcolor="background.default"
            display="flex"
            justifyContent="space-between"
            paddingX={2.5}
            alignItems="center"
            position="relative"
          >
            {/* add button */}
            <Button
              variant="outlined"
              onClick={handleOpenAddAndOpenCamera}
              sx={{
                height: "55px",
                fontSize: "1rem",
                backgroundColor: "background.default",
                color: "text.primary",
                borderColor: "background.default",
                borderRadius: "50px",
                "&:hover": {
                  backgroundColor: "text.primary",
                  color: "background.default",
                  borderColor: "text.primary",
                },
              }}
            >
              <Typography variant="h5">+</Typography>
            </Button>
            {/* title */}
            <Box
              display="flex"
              flexDirection={"row"}
              alignItems={"center"}
              gap={0.5}
            >
              {/* <IconButton 
                  sx={{ ml: 1 }} 
                  onClick={() => setDarkMode(!darkMode)} 
                  color="inherit"
                >
                  {darkMode ? <Brightness7 /> : <Brightness4 />}
                </IconButton> */}
              <Typography variant="h6" color="text.primary" textAlign="center">
                myPantry
              </Typography>
              <Button
                variant="contained"
                disabled={upgradeLoading}
                onClick={handleClick}
                sx={{
                  minWidth: "40px",
                  height: "30px",
                  borderRadius: "8px",
                  px: 1,
                  py: 1,
                  bgcolor: "text.primary",
                  color: "background.default",
                  fontWeight: 600,
                  "&:hover": {
                    bgcolor: "text.secondary",
                  },
                }}
              >
                {userMeta.isPremium ? "Pro" : "Upgrade"}
              </Button>

              {userMeta.isPremium && (
                <Menu
                  anchorEl={anchorEl}
                  open={open}
                  onClose={handleClose}
                  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                  transformOrigin={{ vertical: "top", horizontal: "right" }}
                >
                  <MenuItem
                    onClick={handleCancel}
                    disabled={
                      cancelLoading ||
                      !auth.currentUser?.email ||
                      !userMeta?.isPremium
                    }
                    sx={{
                      color: "error.main",
                      fontWeight: 600,
                      "&:hover": {
                        bgcolor: "error.light",
                        color: "white",
                      },
                    }}
                  >
                    <ListItemIcon>
                      <CancelIcon fontSize="small" sx={{ color: "inherit" }} />
                    </ListItemIcon>
                    <ListItemText primary="Cancel Subscription" />
                  </MenuItem>
                </Menu>
              )}
            </Box>
            {/* sign in */}
            <Box>
              {!user ? (
                <Button
                  onClick={handleSignIn}
                  sx={{
                    justifyContent: "end",
                    right: "2%",
                    backgroundColor: "background.default",
                    color: "text.primary",
                    borderColor: "text.primary",
                    "&:hover": {
                      backgroundColor: "text.primary",
                      color: "background.default",
                      borderColor: "text.primary",
                    },
                  }}
                >
                  Sign In
                </Button>
              ) : (
                <Button
                  onClick={handleSignOut}
                  sx={{
                    backgroundColor: "background.default",
                    color: "text.primary",
                    borderColor: "text.primary",
                    borderWidth: 2,
                    "&:hover": {
                      backgroundColor: "darkgray",
                      color: "text.primary",
                      borderColor: "text.primary",
                    },
                  }}
                >
                  Sign Out
                </Button>
              )}
            </Box>
          </Box>

          <Divider />

          {/* banner image */}
          <Image
            src={"/banner.png"}
            alt="banner"
            // layout="responsive"
            width={800}
            height={200}
            style={{ width: "100%", height: "auto" }}
          />

          {/* recipes */}
          <Stack flexDirection="row">
            {/* title */}
            <Stack
              flexDirection="row"
              alignItems="center"
              gap={{ sx: 1.5, md: 2 }}
            >
              <Typography
                padding={2}
                variant="h4"
                color="text.primary"
                fontWeight="bold"
              >
                Recipes
              </Typography>
              {loading ? (
                <CircularProgress />
              ) : (
                <Button
                  variant="contained"
                  disabled={loading}
                  sx={{
                    borderRadius: "8px",
                    px: { sx: 0, md: 3 },
                    py: { sx: 0, md: 1 },
                    fontWeight: "bold",
                    textTransform: "none",
                    background: "linear-gradient(90deg, #6b7280, #9ca3af)",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
                    color: "white",
                    "&:hover": {
                      background: "linear-gradient(90deg, #4b5563, #6b7280)",
                      transform: "scale(1.05)",
                    },
                    transition: "all 0.2s ease-in-out",
                  }}
                  onClick={async () => {
                    if (!user) {
                      setMakeAccountMsg(true);
                      setAccountMsg("Sign in to generate recipes");
                      setTimeout(() => setMakeAccountMsg(false), 2500); // auto-hide after 2.5s
                      return;
                    }
                    if (pantry.length == 0) {
                      setMakeAccountMsg(true);
                      setAccountMsg("Add items to pantry first");
                      setTimeout(() => setMakeAccountMsg(false), 2500); // auto-hide after 2.5s
                      return;
                    }
                    if (pantry.length > 0) {
                      setLoading(true);
                      const out = await craftRecipes(pantry);
                      setRecipes(out);
                      await addRecipes(out);
                    }
                    setLoading(false);
                  }}
                >
                  <Tooltip
                    open={makeAccountMsg}
                    title={
                      <Box sx={{ p: 1 }}>
                        <Typography variant="body1" fontWeight="500">
                          {accountMsg}
                        </Typography>
                        {/* <Typography variant="body2" sx={{ mt: 0.5 }}>
                          Upgrade to <strong>Premium</strong> for unlimited ✨
                        </Typography> */}
                      </Box>
                    }
                    placement="top"
                    arrow
                    TransitionComponent={Zoom} // gives a zoom-in animation
                    slotProps={{
                      popper: {
                        sx: {
                          "& .MuiTooltip-tooltip": {
                            bgcolor: "white",
                            color: "black",
                            border: "1px solid lightgray",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                            borderRadius: "12px",
                            maxWidth: 250,
                          },
                          "& .MuiTooltip-arrow": {
                            color: "white",
                          },
                        },
                      },
                    }}
                  >
                    {userMeta.isPremium || !user
                      ? "GENERATE"
                      : `GENERATE [${userMeta.freeGenerationsLeft}/3]`}
                  </Tooltip>
                </Button>
              )}
            </Stack>

            {/* search bar */}
            <Autocomplete
              freeSolo
              disableClearable
              options={recipes?.map((option) => option.recipe)}
              onInputChange={(event, newInputValue) => {
                setRecipeSearchTerm(newInputValue);
              }}
              ListboxProps={{
                component: "div",
                sx: {
                  backgroundColor: "background.default",
                  color: "text.primary",
                },
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="outlined"
                  onFocus={() => setIsFocusedRecipe(true)}
                  onBlur={() => setIsFocusedRecipe(false)}
                  sx={{
                    position: "absolute",
                    right: "2%",
                    paddingY: 1,
                    transform: "translateY(0%)",
                    width: isFocusedRecipe
                      ? "25%"
                      : `${Math.max(recipeSearchTerm.length, 0) + 5}ch`,
                    transition: "width 0.3s",
                    "& .MuiOutlinedInput-root": {
                      bgcolor: "background.default",
                      color: "text.primary",
                      "& fieldset": {
                        borderColor: "background.default",
                      },
                      "&:hover fieldset": {
                        borderColor: "text.primary",
                      },
                      "&.Mui-focused fieldset": {
                        borderColor: "text.primary",
                      },
                    },
                    "& .MuiInputBase-input": {
                      color: "text.primary",
                    },
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon style={{ color: "text.primary" }} />
                      </InputAdornment>
                    ),
                  }}
                  InputLabelProps={{
                    style: {
                      color: "text.primary",
                      width: "100%",
                      textAlign: "center",
                      right: "1%",
                    },
                  }}
                />
              )}
            />
          </Stack>
          <Divider />
          {/* recipes stack */}
          <Stack
            paddingX={2}
            flexDirection="row"
            alignItems="flex-start"
            style={{ overflow: "scroll" }}
          >
            {filteredRecipes?.map(
              ({ recipe, ingredients, instructions, image }, index) => (
                <Button
                  key={index}
                  sx={{ color: "text.primary", marginRight: 2, flexShrink: 0 }}
                  onClick={() => handleRecipeModal(index)}
                >
                  {/* recipe item */}
                  <Box
                    display="flex"
                    flexDirection="column"
                    justifyContent="space-between"
                    alignItems="center"
                    bgcolor="background.default"
                    padding={1}
                    sx={{
                      width: "275px",
                      borderRadius: "10px",
                      boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
                      overflow: "hidden",
                    }}
                  >
                    {/* recipe image */}
                    <Stack
                      direction="column"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      {image && image !== null ? (
                        <Image
                          src={image}
                          alt={recipe}
                          width={200}
                          height={200}
                          style={{ borderRadius: "10px" }}
                        />
                      ) : (
                        <Box
                          width={200}
                          height={200}
                          display={"flex"}
                          justifyContent={"center"}
                          alignItems={"center"}
                        >
                          <CircularProgress />
                        </Box>
                        // <Image
                        //   src="/recipe.jpg"
                        //   alt={recipe}
                        //   width={200}
                        //   height={200}
                        //   style={{ borderRadius: "10px", objectFit: "cover" }}
                        // />
                      )}
                    </Stack>
                    {/* recipe name */}
                    <Stack>
                      <Typography
                        variant="h5"
                        color="text.primary"
                        textAlign="center"
                        fontWeight="550"
                        style={{
                          flexGrow: 1,
                          textAlign: "center",
                          overflow: "hidden",
                          padding: 5,
                        }}
                      >
                        {recipe &&
                          truncateString(
                            recipe.charAt(0).toUpperCase() + recipe.slice(1),
                            50
                          )}
                      </Typography>
                    </Stack>
                  </Box>
                </Button>
              )
            )}
          </Stack>

          {/* pantry */}
          <Stack flexDirection="row">
            {/* title */}
            <Typography
              padding={2}
              variant="h4"
              color="text.primary"
              fontWeight="bold"
            >
              In your Pantry
            </Typography>
            {/* search bar */}
            <Autocomplete
              freeSolo
              disableClearable
              options={pantry.map((option) => option.name)}
              onInputChange={(event, newInputValue) => {
                setSearchTerm(newInputValue);
              }}
              ListboxProps={{
                component: "div",
                sx: {
                  backgroundColor: "background.default",
                  color: "text.primary",
                },
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="outlined"
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  sx={{
                    position: "absolute",
                    right: "2%",
                    paddingY: 1,
                    transform: "translateY(0%)",
                    width: isFocused
                      ? "25%"
                      : `${Math.max(searchTerm.length, 0) + 5}ch`,
                    transition: "width 0.3s",
                    "& .MuiOutlinedInput-root": {
                      "& fieldset": {
                        borderColor: "background.default",
                      },
                      "&:hover fieldset": {
                        borderColor: "text.primary",
                      },
                      "&.Mui-focused fieldset": {
                        borderColor: "text.primary",
                      },
                    },
                    "& .MuiInputBase-input": {
                      color: "text.primary",
                    },
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon style={{ color: "text.primary" }} />
                      </InputAdornment>
                    ),
                  }}
                  InputLabelProps={{
                    style: {
                      color: "text.primary",
                      width: "100%",
                      textAlign: "center",
                      right: "1%",
                    },
                  }}
                />
              )}
            />
          </Stack>
          <Divider />
          <Box height={25}></Box>
          {/* pantry stack */}

          <Box display="flex" justifyContent="center">
            <Grid
              container
              spacing={2}
              paddingX={1}
              justifyContent="flex-start" // ✅ correct prop, not sx
              width={{ xs: "330px", sm: "1365px" }}
              // backgroundColor="red"
              style={{
                overflow: "scroll",
              }}
            >
              {filteredPantry.map(({ name, count, image }, index) => (
                <Grid
                  item
                  xs={12} // full width on mobile
                  sm={6} // 2 per row on tablets
                  md={4} // 3 per row on desktops
                  key={index}
                  display="flex" // ✅ make item itself flexbox
                  justifyContent="center" // ✅ ensures each card is centered
                >
                  <Box
                    width="325px"
                    display="flex"
                    flexDirection="row"
                    justifyContent="space-between"
                    alignItems="center"
                    backgroundColor="background.default"
                    padding={2.5}
                    border="1px solid lightgray"
                    borderRadius="10px"
                  >
                    {/* pantry ingredient name and quantity change */}
                    <Stack>
                      <Typography
                        variant="h6"
                        color="text.primary"
                        textAlign="left"
                        style={{
                          flexGrow: 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {truncateString(
                          name.charAt(0).toUpperCase() + name.slice(1),
                          16
                        )}
                      </Typography>
                      {/* quantity adjuster */}
                      <Stack
                        width="100%"
                        direction="row"
                        justifyContent="start"
                        alignItems="center"
                      >
                        <Button
                          sx={{
                            height: "25px",
                            minWidth: "25px",
                            backgroundColor: "lightgray",
                            color: "black",
                            borderColor: "lightgray",
                            borderRadius: "50px",
                            "&:hover": {
                              backgroundColor: "darkgray",
                              color: "text.primary",
                              borderColor: "text.primary",
                            },
                          }}
                          onClick={() =>
                            handleQuantityChange(name, Math.max(0, count - 1))
                          }
                        >
                          -
                        </Button>
                        <TextField
                          label=""
                          variant="outlined"
                          value={parseInt(count)}
                          onChange={(e) =>
                            handleQuantityChange(
                              name,
                              parseInt(e.target.value) || 0
                            )
                          }
                          sx={{
                            width: "45px",
                            "& .MuiOutlinedInput-root": {
                              color: "text.primary",
                              "& fieldset": {
                                borderColor: "background.default",
                              },
                              "&:hover fieldset": {
                                borderColor: "background.default",
                              },
                              "&.Mui-focused fieldset": {
                                borderColor: "lightgray",
                              },
                            },
                            "& .MuiInputLabel-root": {
                              color: "text.primary",
                            },
                          }}
                          InputProps={{
                            sx: {
                              textAlign: "center",
                              fontSize: "0.75rem",
                            },
                            inputProps: {
                              style: { textAlign: "center" },
                            },
                          }}
                          InputLabelProps={{
                            style: {
                              color: "text.primary",
                              width: "100%",
                              textAlign: "center",
                            },
                          }}
                        />
                        <Button
                          sx={{
                            height: "25px",
                            minWidth: "25px",
                            backgroundColor: "lightgray",
                            color: "black",
                            borderColor: "lightgray",
                            borderRadius: "50px",
                            "&:hover": {
                              backgroundColor: "darkgray",
                              color: "text.primary",
                              borderColor: "text.primary",
                            },
                          }}
                          onClick={() => handleQuantityChange(name, count + 1)}
                        >
                          +
                        </Button>
                      </Stack>
                    </Stack>
                    {/* pantry ingredient image */}
                    <Stack
                      width="100%"
                      direction="column"
                      justifyContent="space-between"
                      alignItems="flex-end"
                    >
                      {image ? (
                        <Image
                          src={image}
                          alt={name}
                          width={100}
                          height={100}
                          style={{ borderRadius: "10px" }}
                        />
                      ) : (
                        <Image
                          src="/ingredients.jpg"
                          alt={name}
                          width={100}
                          height={100}
                          style={{ borderRadius: "10px", objectFit: "cover" }}
                        />
                      )}
                    </Stack>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
