"use client"

import { Box, Stack, Typography, Button, Modal, TextField, Grid, Autocomplete, Divider } from '@mui/material'
import { firestore, auth, provider, signInWithPopup, signOut } from '@/firebase'
import { collection, getDocs, query, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { useEffect, useState, useRef } from 'react'

import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';

import Image from 'next/image';
import { Camera } from 'react-camera-pro';

const openaiApiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
import { OpenAI } from 'openai';

import { onAuthStateChanged } from 'firebase/auth';

export default function Home() {
  // declare
  const [pantry, setPantry] = useState([])
  const [recipes, setRecipes] = useState([])
  const [openRecipeModal, setOpenRecipeModal] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState({});
  const [openAdd, setOpenAdd] = useState(false);
  const handleOpenAdd = () => {
    clearFields();
    setOpenAdd(true)
  };
  const handleCloseAdd = () => {
    clearFields();
    setOpenAdd(false)
  };
  
  const [searchTerm, setSearchTerm] = useState('');
  const [recipeSearchTerm, setRecipeSearchTerm] = useState('');
  const [itemName, setItemName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [isFocused, setIsFocused] = useState(false); 
  const [isFocusedRecipe, setIsFocusedRecipe] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [image, setImage] = useState(null);
  const cameraRef = useRef(null);
  const [numberOfCameras, setNumberOfCameras] = useState(0);
  
  const openai = new OpenAI({
    apiKey: openaiApiKey,
    dangerouslyAllowBrowser: true
  });
  
  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function predictItem(image){
    if(image){
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: "text",
                text: "Identify the main object in this picture in as few words as possible",
              },
              {
                type: "image_url",
                image_url: {
                  url: image,
                  detail: "low",
                },
              },
            ],
          },
        ],
      })
      let result = response.choices[0].message.content.trim();
      result = result.replace(/\./g, '');
      result = result.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      return result;
    }
  }

  async function craftRecipes(pantry) {
    if (pantry.length !== 0) {
        const ingredients = pantry.map(item => item.name).join(', ');

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'user',
                    content: `Here is a list of ingredients: ${ingredients}. Classify them into foods and non-foods. Create recipes only using the foods provided. Do not use foods that are not in the ingredients list. Only print the recipes. Format it like this: Recipe: Fish & Ham Sandwich (linebreak) Ingredients: Fish, Ham (linebreak) Instructions: Layer slices of ham and cooked fish between two pieces of bread. Serve chilled or grilled.`,
                },
            ],
        });

        const result = response.choices[0].message.content.trim().split("\n\n");

        const recipePromises = result.map(async (item) => {
            const parts = item.split("\n");
            let recipe = '';
            let ingredients = '';
            let instructions = '';

            if (parts.length > 0) {
                recipe = parts[0].split(": ")[1].replace(/\*/g, '') || '';
            }
            if (parts.length > 1) {
                ingredients = parts[1].split(": ")[1].replace(/\*/g, '') || '';
            }
            if (parts.length > 2) {
                instructions = parts[2].split(": ")[1].replace(/\*/g, '') || '';
            }

            if (!recipe || !ingredients || !instructions) {
                console.error('Failed to parse recipe details:', item);
                return null;
            }

            const image = await createImage(recipe);
            return { recipe, ingredients, instructions, image };
        });

        const recipes = await Promise.all(recipePromises);
        return recipes.filter(recipe => recipe !== null);
    }
    return [];
  }

  async function createImage(label) {
    try {
        const response = await openai.images.generate({
            model: 'dall-e-2',
            prompt: label,
            n: 1,
            size: "256x256",
            response_format: 'b64_json',
        });
        const ret = response.data;
        if (ret && ret.length > 0) {
            const base64String = ret[0].b64_json;
            return `data:image/png;base64,${base64String}`;
        }
        return null;
    } catch (error) {
        if (error.response && error.response.status === 429) {
            console.log("Rate limit exceeded. Retrying in 10 seconds...");
            await sleep(10000); // Wait for 10 seconds
            return createImage(label); // Retry the request
        } else {
            console.error("Error creating image:", error);
        }
    }
  }

  const truncateString = (str, num) => {
    if (str.length <= num) {
      return str;
    }
    return str.slice(0, num) + '...';
  };

  const clearFields = () => {
    setItemName('');
    setQuantity(1);
    setImage(null);
  };

  const updatePantry = async () => {
    if (auth.currentUser) {
      const userUID = auth.currentUser.uid;
      const snapshot = query(collection(firestore, `pantry_${userUID}`));
      const docs = await getDocs(snapshot);
      const pantryList = [];
      docs.forEach((doc) => {
        pantryList.push({ name: doc.id, ...doc.data() });
      });
      setPantry(pantryList);
    }
  };

  useEffect(() => {
    updatePantry()
  }, [])

  const generateRecipes = async () => {
    const recipes = await craftRecipes(pantry);
    setRecipes(recipes);
  };

  useEffect(() => {
    generateRecipes()
  }, [pantry])

  const addItem = async (item, quantity, image) => {
    if (guestMode) {
      setPantry(prevPantry => [...prevPantry, { name: item, count: quantity, image }]);
    } else {
      if (!auth.currentUser) {
        alert("You must be signed in to add items.");
        return;
      }
      if (isNaN(quantity) || quantity < 0) {
        setOpenWarningAdd(true);
      } else if (quantity >= 1 && item != '') {
        const userUID = auth.currentUser.uid;
        const docRef = doc(collection(firestore, `pantry_${userUID}`), item);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const { count, image: existingImage } = docSnap.data();
          await setDoc(docRef, { count: count + quantity, image: image || existingImage });
        } else {
          await setDoc(docRef, { count: quantity, image });
        }
        await updatePantry();
      }
    }
  }

  const handleQuantityChange = async (item, quantity) => {
    if (guestMode) {
      setPantry(prevPantry => prevPantry.map(p => p.name === item ? { ...p, count: quantity } : p));
    } else {
      if (!auth.currentUser) {
        alert("You must be signed in to change item quantities.");
        return;
      }
      const userUID = auth.currentUser.uid;
      const docRef = doc(collection(firestore, `pantry_${userUID}`), item);
      const docSnap = await getDoc(docRef);
      const { count, image } = docSnap.data();
      if (0 === quantity) {
        await deleteDoc(docRef);
      } else {
        await setDoc(docRef, { count: quantity, ...(image && { image }) });
      }
      await updatePantry();
    }
  };

  const handleOpenAddAndOpenCamera = () => {
    handleOpenAdd();
    setCameraOpen(true);
  };

  const filteredPantry = pantry.filter(({ name }) => name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredRecipes = recipes.filter(({ recipe }) => recipe.toLowerCase().includes(recipeSearchTerm.toLowerCase()));
  
  const handleRecipeModal = (index) => {
    setSelectedRecipe(index);
    setOpenRecipeModal(true);
  };

  const handleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      console.log('User signed in:', user);
      setGuestMode(false); // Disable guest mode on successful sign-in
    } catch (error) {
      console.error('Error signing in:', error);
      alert('Sign in failed: ' + error.message);
    }
  };
  
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      console.log('User signed out');
      setUser(null);
      setGuestMode(true); // Enable guest mode on sign-out
      setPantry([]); // Clear guest data
      setRecipes([]); // Clear guest data
    } catch (error) {
      console.error('Error signing out:', error);
      alert('Sign out failed: ' + error.message);
    }
  };

  const [user, setUser] = useState(null);
  const [guestMode, setGuestMode] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUser(user);
        setGuestMode(false);
        updatePantry();
      } else {
        setUser(null);
        setGuestMode(true);
        setPantry([]);
        setRecipes([]);
      }
    });
    return () => unsubscribe();
  }, []);

  return (
   <Box 
     width="100vw" 
     height="100vh"
     display="flex" 
     justifyContent="center" 
     alignItems="center"
     flexDirection="column"
     gap={2}
     bgcolor="white"
     fontFamily="sans-serif"
   >
    <Modal
      open={openAdd}
      onClose={handleCloseAdd}
    >
      <Box 
        sx={{
          position: 'absolute',
          top: '10%',
          width: '100%',
          height: '90%',
          bgcolor: 'white',
          border: '2px solid #000',
          boxShadow: 24,
          p: 2,
          display: "flex",
          alignItems: 'center',
          flexDirection: 'column',
          gap: 3,
          color: "black",
          borderColor: "black",
          borderRadius: "15px",
        }}
      >
        {image && (
          <Box
            display="flex"
            justifyContent="center"
            width="100%"
            sx={{
              borderRadius: '16px',
              overflow: 'hidden',
            }}
          >
            <Image 
              src={image}
              alt={"Captured"}
              width={300}
              height={300}
              style={{ borderRadius: '16px' }}
            />
          </Box>
        )}
        {!image && (
          <Button 
            variant="outlined"
            onClick={() => setCameraOpen(true)}
            sx={{
              color: 'black',
              borderColor: 'black',
              '&:hover': {
                backgroundColor: 'black',
                color: 'white',
                borderColor: 'black',
              },
            }}
          >
            Open Camera
          </Button>
        )}
        <Divider sx={{ width: '100%', backgroundColor: 'white' }} />
        <Box width="100%" height="25%">
          <TextField 
            label="" 
            variant="outlined"
            fullWidth
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                color: 'black',
                fontSize: '2.5rem',
                fontWeight: '550',
                '& fieldset': {
                  borderColor: 'white',
                },
                '&:hover fieldset': {
                  borderColor: 'white',
                },
                '&.Mui-focused fieldset': {
                  borderColor: 'lightgray',
                },
              },
              '& .MuiInputLabel-root': {
                color: 'black',
                fontSize: '2.5rem',
                fontWeight: '550',
              },
            }}
            InputProps={{
              style: {
                textAlign: 'center',
                fontSize: '1.5rem',
              }
            }}
            InputLabelProps={{
              style: { 
                color: 'black', 
                width: '100%',
                fontSize: '1.5rem',
              },
            }}
          />
        </Box>
        <Stack width="100%" direction="column" spacing={2} justifyContent="space-between">
          <Stack width="100%" direction="row" justifyContent="end" alignItems="center">
            <Button 
              sx={{
                backgroundColor: 'lightgray',
                color: 'black',
                borderColor: 'lightgray',
                borderRadius: '50px',
                height: "50px",
                minWidth: "50px",
                '&:hover': {
                  backgroundColor: 'darkgray',
                  color: 'white',
                  borderColor: 'black',
                },
              }}
              onClick={() => setQuantity(prev => Math.max(0, parseInt(prev) - 1))}
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
                '& .MuiOutlinedInput-root': {
                  color: 'black',
                  '& fieldset': {
                    borderColor: 'white',
                  },
                  '&:hover fieldset': {
                    borderColor: 'white',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: 'lightgray',
                  },
                },
                '& .MuiInputLabel-root': {
                  color: 'black',
                },
              }}
              InputLabelProps={{
                style: { color: 'black', width: '100%' },
              }}
            />
            <Button 
              sx={{
                backgroundColor: 'lightgray',
                color: 'black',
                borderColor: 'lightgray',
                borderRadius: '50px',
                height: "50px",
                minWidth: "50px",
                '&:hover': {
                  backgroundColor: 'darkgray',
                  color: 'white',
                  borderColor: 'black',
                },
              }}
              onClick={() => setQuantity(prev => parseInt(prev) + 1)}
            >
              +
            </Button>
          </Stack>
          <Button 
            variant="outlined"
            onClick={() => {
              addItem(itemName, parseInt(quantity), image)
              setItemName('')
              setQuantity(1)
              handleCloseAdd()
            }}
            sx={{
              backgroundColor: 'black',
              color: 'white',
              borderColor: 'black',
              '&:hover': {
                backgroundColor: 'darkgray',
                color: 'white',
                borderColor: 'black',
              },
            }}
          >
            Add
          </Button>
        </Stack>
      </Box>
    </Modal>

    <Modal open={cameraOpen} onClose={() => setCameraOpen(false)}>
      <Box width="100vw" height="100vh" backgroundColor="black">
        <Stack display="flex" justifyContent="center" alignItems="center" flexDirection="column" sx={{ transform: 'translate(0%,25%)' }}>
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              bgcolor: 'black',
              width: 350,
              height: 350,
              bgcolor: 'black',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              position: 'relative',
              paddingY: 2,
            }}
          >
            <Box
              sx={{
                flex: 1,
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Camera
                ref={cameraRef}
                onTakePhoto={(dataUri) => {
                  setImage(dataUri);
                  setCameraOpen(false);
                }}
              />
            </Box>
          </Box>
          <Stack flexDirection="row" gap={2} position="relative">
            <Button 
              variant="outlined"
              onClick={() => {
                if (cameraRef.current) {
                  const photo = cameraRef.current.takePhoto();
                  setImage(photo);
                  setCameraOpen(false);
                  predictItem(photo).then(setItemName);
                }
              }}
              sx={{
                color: 'black',
                borderColor: 'white',
                backgroundColor: 'white',
                '&:hover': {
                  backgroundColor: 'white',
                  color: 'black',
                  borderColor: 'white',
                },
                marginTop: 1,
              }}
            >
              Take Photo
            </Button>
            <Button
              hidden={numberOfCameras <= 1}
              onClick={() => {
                if (cameraRef.current) {
                  const result = cameraRef.current.switchCamera();
                  console.log(numberOfCameras)
                  console.log(result)
                }
              }}
              sx={{
                color: 'black',
                borderColor: 'white',
                backgroundColor: 'white',
                '&:hover': {
                  backgroundColor: 'white',
                  color: 'black',
                  borderColor: 'white',
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
                color: 'black',
                borderColor: 'white',
                backgroundColor: 'white',
                '&:hover': {
                  backgroundColor: 'white',
                  color: 'black',
                  borderColor: 'white',
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

    <Modal open={openRecipeModal} onClose={() => setOpenRecipeModal(false)}>
      <Box
        overflow="auto"
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 400,
          height: '90%',
          bgcolor: 'white',
          border: '2px solid #000',
          boxShadow: 24,
          p: 4,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {selectedRecipe !== null && recipes[selectedRecipe] && (
          <>
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              width="100%"
              paddingY={2}
            >
              {recipes[selectedRecipe].image && recipes[selectedRecipe].image !== null ? (
                <Image 
                  src={recipes[selectedRecipe].image}
                  alt={recipes[selectedRecipe].recipe}
                  width={200}
                  height={200}
                  style={{ borderRadius: '10px' }}
                />
              ) : (
                <Image 
                  src="/recipe.jpg"
                  alt={recipes[selectedRecipe].recipe}
                  width={200}
                  height={200}
                  style={{ borderRadius: '10px', objectFit: 'cover' }}
                />
              )}
            </Box>
            <Typography variant="h6" component="h2" fontWeight='600'>
              {recipes[selectedRecipe].recipe}
            </Typography>
            <Typography sx={{ mt: 2 }}>
              <strong>Ingredients:</strong> {recipes[selectedRecipe].ingredients}
            </Typography>
            <Typography sx={{ mt: 2 }}>
              <strong>Instructions:</strong> {recipes[selectedRecipe].instructions}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button 
              variant="outlined"
              onClick={() => {
                setOpenRecipeModal(false)
              }}
              sx={{
                backgroundColor: 'black',
                color: 'white',
                borderColor: 'black',
                '&:hover': {
                  backgroundColor: 'darkgray',
                  color: 'white',
                  borderColor: 'black',
                },
              }}
            >
              Close
            </Button>
          </>
        )}
      </Box>
    </Modal>

    <Box width="100%" height="100%" bgcolor="white">
      <Box 
        height="10%" 
        bgcolor="white"
        display="flex"
        justifyContent="space-between"
        paddingX={2.5}
        alignItems="center"
        position="relative"
      >
        <Button 
          variant="outlined" 
          onClick={handleOpenAddAndOpenCamera}
          sx={{
            height: "55px",
            fontSize: '1rem',
            borderColor: 'white',
            borderRadius: '50px',
            '&:hover': {
              color: '#636363',
              borderColor: 'white',
            },
          }}
        >
          <Typography variant="h5" color="black">+</Typography>
        </Button>
        <Typography variant="h6" color="black" textAlign="center">
          myPantry
        </Typography>
        <Box>
          {!user ? (
            <Button 
              onClick={handleSignIn}
              sx={{
                justifyContent: "end",
                right: "2%",
                backgroundColor: 'white',
                color: 'black',
                borderColor: 'black',
                '&:hover': {
                  backgroundColor: 'black',
                  color: 'white',
                  borderColor: 'black',
                },
              }}
            >
              Sign In
            </Button>
          ) : (
            <Button 
              onClick={handleSignOut}
              sx={{
                backgroundColor: 'white',
                color: 'black',
                borderColor: 'black',
                borderWidth: 2,
                '&:hover': {
                  backgroundColor: 'darkgray',
                  color: 'white',
                  borderColor: 'black',
                },
              }}
            >
              Sign Out
            </Button>
          )}
        </Box>
      </Box>

      <Divider />

      <Image 
        src="/banner.png"
        alt="banner"
        // layout="responsive"
        width={800}
        height={200}
        style={{ width: '100%', height: 'auto' }}
      />

      <Stack flexDirection="row">
        <Typography padding={2} variant="h4" color="#3C3C3C" fontWeight="bold">Recipes</Typography>
        <Autocomplete
          freeSolo
          disableClearable
          options={recipes.map((option) => option.recipe)}
          onInputChange={(event, newInputValue) => {
            setRecipeSearchTerm(newInputValue);
          }}
          ListboxProps={{
            component: 'div',
            sx: {
              backgroundColor: 'white',
              color: 'black',
            }
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="outlined"
              onFocus={() => setIsFocusedRecipe(true)}
              onBlur={() => setIsFocusedRecipe(false)}
              sx={{
                position: 'absolute',
                right: "2%",
                paddingY: 1,
                transform: 'translateY(0%)',
                width: isFocusedRecipe ? '25%' : `${Math.max(recipeSearchTerm.length, 0) + 5}ch`,
                transition: 'width 0.3s',
                '& .MuiOutlinedInput-root': {
                  '& fieldset': {
                    borderColor: 'white',
                  },
                  '&:hover fieldset': {
                    borderColor: 'black',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: 'black',
                  },
                },
                '& .MuiInputBase-input': {
                  color: 'black',
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon style={{ color: 'black' }} />
                  </InputAdornment>
                ),
              }}
              InputLabelProps={{
                style: { color: 'black', width: '100%', textAlign: 'center', right: '1%' },
              }}
            />
          )}
        />
      </Stack>
      <Divider />
      <Stack paddingX={2} flexDirection="row" alignItems="flex-start" style={{ overflow: 'scroll' }}>
        {filteredRecipes.map(({ recipe, ingredients, instructions, image }, index) => (
          <Button 
            key={index} 
            sx={{ color: "black", marginRight: 2, flexShrink: 0 }}
            onClick={() => handleRecipeModal(index)}
          >
            <Box
              display="flex"
              flexDirection="column"
              justifyContent="space-between"
              alignItems="center"
              bgcolor="white"
              padding={1}
              sx={{
                width: '275px',
                borderRadius: '10px',
                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
                overflow: 'hidden',
              }}
            >
              <Stack direction="column" justifyContent="space-between" alignItems="center">
                {image && image !== null ? (
                  <Image 
                    src={image}
                    alt={recipe}
                    width={200}
                    height={200}
                    style={{ borderRadius: '10px' }}
                  />
                ) : (
                  <Image 
                    src="/recipe.jpg"
                    alt={recipe}
                    width={200}
                    height={200}
                    style={{ borderRadius: '10px', objectFit: 'cover' }}
                  />
                )}
              </Stack>
              <Stack>
                <Typography
                  variant="h5"
                  color="black"
                  textAlign="center"
                  fontWeight="550"
                  style={{
                    flexGrow: 1,
                    textAlign: "center",
                    overflow: 'hidden',
                    padding: 5,
                  }}
                >
                  {truncateString(recipe.charAt(0).toUpperCase() + recipe.slice(1), 50)}
                </Typography>
              </Stack>
            </Box>
          </Button>
        ))}
      </Stack>

      <Stack flexDirection="row">
        <Typography padding={2} variant="h4" color="#3C3C3C" fontWeight="bold">In your Pantry</Typography>
        <Autocomplete
          freeSolo
          disableClearable
          options={pantry.map((option) => option.name)}
          onInputChange={(event, newInputValue) => {
            setSearchTerm(newInputValue);
          }}
          ListboxProps={{
            component: 'div',
            sx: {
              backgroundColor: 'white',
              color: 'black',
            }
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="outlined"
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              sx={{
                position: 'absolute',
                right: "2%",
                paddingY: 1,
                transform: 'translateY(0%)',
                width: isFocused ? '25%' : `${Math.max(searchTerm.length, 0) + 5}ch`,
                transition: 'width 0.3s',
                '& .MuiOutlinedInput-root': {
                  '& fieldset': {
                    borderColor: 'white',
                  },
                  '&:hover fieldset': {
                    borderColor: 'black',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: 'black',
                  },
                },
                '& .MuiInputBase-input': {
                  color: 'black',
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon style={{ color: 'black' }} />
                  </InputAdornment>
                ),
              }}
              InputLabelProps={{
                style: { color: 'black', width: '100%', textAlign: 'center', right: '1%' },
              }}
            />
          )}
        />
      </Stack>
      <Divider />
      <Box height={25}></Box>
      <Grid container spacing={2} paddingX={1} style={{ height: '50%', overflow: 'scroll' }}>
        {filteredPantry.map(({ name, count, image }, index) => (
          <Grid item xs={12} sm={4} key={index}>
            <Box
              width="100%"
              display="flex"
              flexDirection="row"
              justifyContent="space-between"
              alignItems="center"
              backgroundColor="white"
              padding={2.5}
              border="1px solid lightgray"
              borderRadius="10px"
            >
              <Stack>
                <Typography
                  variant="h6"
                  color="black"
                  textAlign="left"
                  style={{
                    flexGrow: 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {truncateString(name.charAt(0).toUpperCase() + name.slice(1), 16)}
                </Typography>
                <Stack width="100%" direction="row" justifyContent="start" alignItems="center">
                  <Button
                    sx={{
                      height: "25px",
                      minWidth: "25px",
                      backgroundColor: 'lightgray',
                      color: 'black',
                      borderColor: 'lightgray',
                      borderRadius: '50px',
                      '&:hover': {
                        backgroundColor: 'darkgray',
                        color: 'white',
                        borderColor: 'black',
                      },
                    }}
                    onClick={() => handleQuantityChange(name, Math.max(0, count - 1))}
                  >
                    -
                  </Button>
                  <TextField
                    label=""
                    variant="outlined"
                    value={parseInt(count)}
                    onChange={(e) => handleQuantityChange(name, parseInt(e.target.value) || 0)}
                    sx={{
                      width: "45px",
                      '& .MuiOutlinedInput-root': {
                        color: 'black',
                        '& fieldset': {
                          borderColor: 'white',
                        },
                        '&:hover fieldset': {
                          borderColor: 'white',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: 'lightgray',
                        },
                      },
                      '& .MuiInputLabel-root': {
                        color: 'black',
                      },
                    }}
                    InputProps={{
                      sx: {
                        textAlign: 'center',
                        fontSize: '0.75rem',
                      },
                      inputProps: {
                        style: { textAlign: 'center' },
                      },
                    }}
                    InputLabelProps={{
                      style: { color: 'black', width: '100%', textAlign: 'center' },
                    }}
                  />
                  <Button
                    sx={{
                      height: "25px",
                      minWidth: "25px",
                      backgroundColor: 'lightgray',
                      color: 'black',
                      borderColor: 'lightgray',
                      borderRadius: '50px',
                      '&:hover': {
                        backgroundColor: 'darkgray',
                        color: 'white',
                        borderColor: 'black',
                      },
                    }}
                    onClick={() => handleQuantityChange(name, count + 1)}
                  >
                    +
                  </Button>
                </Stack>
              </Stack>
              <Stack width="100%" direction="column" justifyContent="space-between" alignItems="flex-end">
                {image ? (
                  <Image
                    src={image}
                    alt={name}
                    width={100}
                    height={100}
                    style={{ borderRadius: '10px' }}
                  />
                ) : (
                  <Image
                    src="/ingredients.jpg"
                    alt={name}
                    width={100}
                    height={100}
                    style={{ borderRadius: '10px', objectFit: 'cover'}}
                  />
                )}
              </Stack>
            </Box>
          </Grid>
        ))}
      </Grid>
    </Box>
   </Box>
  );
}
