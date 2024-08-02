"use client"

import {Box, Stack, Typography, Button, Modal, TextField, Grid, Autocomplete, Divider} from '@mui/material'
import {firestore} from '@/firebase'
import {collection, getDocs, query, doc, setDoc, deleteDoc, getDoc} from 'firebase/firestore';
import { useEffect, useState, useRef } from 'react'

import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';


// react-camera-use
import Image from 'next/image';
import {Camera} from 'react-camera-pro';

// openai-use
const openaiApiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
import { OpenAI } from 'openai';

export default function Home() {
  // declare
  const [pantry, setPantry] = useState([])
  // recipes
  const [recipes, setRecipes] = useState([])
  const [openRecipeModal, setOpenRecipeModal] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState({});

  // add modal
  const [openAdd, setOpenAdd] = useState(false);
  const handleOpenAdd = () => {
    clearFields();
    setOpenAdd(true)
  };
  const handleCloseAdd = () => {
    clearFields();
    setOpenAdd(false)
  };
  
  // miscellaneous, helpers for autocomplete search func, controlling itemName and quantity variables, and moving the search text upon click
  const [searchTerm, setSearchTerm] = useState('');
  const[itemName, setItemName] = useState('')
  const[quantity, setQuantity] = useState('')
  const [isFocused, setIsFocused] = useState(false); // Added isFocused state
  // camera
  const [cameraOpen, setCameraOpen] = useState(false); // State to open the camera
  const [image, setImage] = useState(null); // State to store the captured image
  const cameraRef = useRef(null);
  const [numberOfCameras, setNumberOfCameras] = useState(0);
  // ai
  const openai = new OpenAI({
    apiKey: openaiApiKey,
    dangerouslyAllowBrowser: true
  });
  // predict the item from image using
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
                image_url:{
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
  // craft recipe from pantry items using ai
  async function craftRecipes(pantry) {
    // Format the pantry list into a string
    if(pantry.length != 0){
      const ingredients = pantry.map(item => item.name).join(', ');
    
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: `Here is a list of ingredients: ${ingredients}. Classify them into foods and non-foods. Create recipes only using the foods provided. Do not use foods that are not in the ingredients list. Only print the recipes. Format it like this: Recipe: Fish & Ham Sandwich (linebreak) Ingredients: Fish, Ham (linebreak) Instructions: Layer slices of ham and cooked fish between two pieces of bread. Serve chilled or grilled.`,
          },
        ],
      });
    
      // Extract the response content
      let result = response.choices[0].message.content.trim().split("\n\n");
      let recipes = result.map(item => {
        let parts = item.split("\n");
        // Initialize variables to store the recipe details
        let recipe = '';
        let ingredients = '';
        let instructions = '';
        // Check if the expected number of parts exist before accessing them
        if (parts.length > 0) {
          recipe = parts[0].split(": ")[1] || '';
        }
        if (parts.length > 1) {
          ingredients = parts[1].split(": ")[1] || '';
        }
        if (parts.length > 2) {
          instructions = parts[2].split(": ")[1] || '';
        }
        // Handle the case where the expected parts are not found
        if (!recipe || !ingredients || !instructions) {
          console.error('Failed to parse recipe details:', item);
        }
        return { recipe, ingredients, instructions };
      });
      return recipes;
  }
  return [];
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

  // function: update the list, pantryList, according to the firestore database
  const updatePantry = async() => {
    const snapshot = query(collection(firestore, 'pantry'))
    const docs = await getDocs(snapshot)
    const pantryList = []
    docs.forEach((doc) => {
      pantryList.push({name: doc.id, ...doc.data()})
    })
    setPantry(pantryList)

  }
  useEffect(() => {
    updatePantry()
  }, [])
  // recipes
  const generateRecipes = async () => {
    const recipes = await craftRecipes(pantry);
    setRecipes(recipes);
  };
  useEffect(() => {
    generateRecipes()
  }, [pantry])

  // function: add an item to the firestore database. if it exists, add one to count
  const addItem = async (item, quantity, image) => {
    if (isNaN(quantity) || quantity < 0) {
      setOpenWarningAdd(true);
    } else if (quantity >= 1 && item != ''){
      const docRef = doc(collection(firestore, 'pantry'), item);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const { count, image: existingImage } = docSnap.data();
        await setDoc(docRef, { count: count + quantity, image: image || existingImage });
      } else {
        await setDoc(docRef, { count: quantity, image });
      }
      await updatePantry();
    }
  };  

  // function: delete an item from the firestore database. if count >1, count -=1.
  const handleQuantityChange = async (item, quantity) => {
    const docRef = doc(collection(firestore, 'pantry'), item)
    const docSnap = await getDoc(docRef)
    const {count, image} = docSnap.data()
    if (0 === quantity) {
      await deleteDoc(docRef);
    } else {
      await setDoc(docRef, { count: quantity, ...(image && { image })});
    }
    await updatePantry()
  }

  // openadd and open camera
  const handleOpenAddAndOpenCamera = () => {
    handleOpenAdd();
    setCameraOpen(true);
  };

  // filter the pantry per search term. the search function calls the list, filteredPantry, which will be edited by the search term
  const filteredPantry = pantry.filter(({ name }) => name.toLowerCase().includes(searchTerm.toLowerCase()));
  
  const handleRecipeModal = (index) => {
    setSelectedRecipe(index);
    setOpenRecipeModal(true);
  };
  // start of the display function
  return (
    // the base og box
   <Box 
   width="100vw" 
   height="100vh"
   display={'flex'} 
   justifyContent={'center'} 
   alignItems={'center'}
   flexDirection={'column'}
   gap ={2}
   bgcolor={'white'}
   fontFamily={'sans-serif'}
   >
    {/* the add pop up */}
    <Modal
      open={openAdd}
      onClose={handleCloseAdd}
      // aria-labelledby="modal-modal-title"
      // aria-describedby="modal-modal-description"
    >
      {/* add pop up box */}
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
        {/* add item text */}
        {/* <Typography id="modal-modal-title" variant="h6" component="h2" textAlign={'center'}>
          Add Item
        </Typography> */}
        {image && (
          <Box
            display="flex"
            justifyContent="center"
            width="100%"
            sx={{
              borderRadius: '16px', // Adjust the border radius as needed
              overflow: 'hidden', // Ensure the border radius is applied properly
            }}
          >
            <Image 
              src={image}
              alt={"Captured"}
              width={300}
              height={300}
              style={{ borderRadius: '16px' }} // Apply the same border radius to the image
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
        {/* Stack for item field */}
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
                fontSize: '2.5rem', // Adjust font size as needed
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
                fontSize: '2.5rem', // Adjust label font size as needed
                fontWeight: '550',
              },
            }}
            InputProps={{
              style: {
                textAlign: 'center',
                fontSize: '1.5rem', // Adjust input font size as needed
              }
            }}
            InputLabelProps={{
              style: { 
                color: 'black', 
                width: '100%',
                fontSize: '1.5rem', // Adjust label font size as needed
              },
            }}
          />
        </Box>
        {/* Stack for quantity field and add button */}
        <Stack width="100%" direction={'column'} spacing={2} justifyContent={'space-between'}>
          <Stack width="100%" direction={'row'} justifyContent={'end'} alignItems={'center'}>
          <Button sx={{
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
              onClick={() => setQuantity(prev => Math.max(0, parseInt(prev) - 1))} // Decrement quantity
            >-</Button>
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
                onClick={() => setQuantity(prev => parseInt(prev) + 1)} // Increment quantity
              >+</Button>
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
    {/* Camera Modal */}
    <Modal open={cameraOpen} onClose={() => setCameraOpen(false)}>
      <Box width="100vw" height="100vh" backgroundColor="black">
        <Stack display = {'flex'} justifyContent={'center'} alignItems={'center'} flexDirection={'column'} sx={{transform: 'translate(0%,25%)'}}>
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              // left: '50%',
              // transform: 'translate(0%, -50%)',
              bgcolor: 'black',
              width: 350,
              height: 350, // Adjust height to accommodate the button at the bottom
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
                flex: 1, // Ensure the camera takes up all available space except for the button
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
          <Stack flexDirection={"row"} gap  = {2} position = {'relative'}>
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
                  marginTop: 1, // Optional: Add some margin-top for better spacing
                }}
              >Take Photo</Button>
              <Button
              hidden={numberOfCameras <= 1}
              onClick={() => {
                cameraRef.current.switchCamera();
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
                marginTop: 1, // Optional: Add some margin-top for better spacing
              }}
            >Switch Camera</Button>
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
                  marginTop: 1, // Optional: Add some margin-top for better spacing
                }}
              >Exit</Button>
          </Stack>
          </Stack>
        </Box>
    </Modal>

    {/* Recipe Modal */}
    <Modal open={openRecipeModal} onClose={() => setOpenRecipeModal(false)}>
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 400,
            bgcolor: 'white',
            border: '2px solid #000',
            boxShadow: 24,
            p: 4,
          }}
        >
          {selectedRecipe !== null && recipes[selectedRecipe] && (
            <>
              <Typography variant="h6" component="h2" fontWeight='600'>
                {recipes[selectedRecipe].recipe}
              </Typography>
              <Typography sx={{ mt: 2 }}>
                <strong>Ingredients:</strong> {recipes[selectedRecipe].ingredients}
              </Typography>
              <Typography sx={{ mt: 2 }}>
                <strong>Instructions:</strong> {recipes[selectedRecipe].instructions}
              </Typography>
            </>
          )}
          
        </Box>
      </Modal>

    {/* Main page */}
    <Box
    width = "100%"
    height = "100%"
    bgcolor = {'white'}
    >
      {/* Title box, includes add button, title, and search bar */}
      <Box 
      // width = "800px" 
      height = "10%" 
      bgcolor = {'white'} 
      display={'flex'}
      justifyContent={'center'}
      alignItems={'center'} 
      position={'relative'}
      >
        {/* add button */}
        <Button 
        variant="outlined" 
        onClick={handleOpenAddAndOpenCamera}
        sx={{ 
          position: 'absolute', 
          left: "2%",
          // top: '50%', 
          // transform: 'translateY(-50%)',
          // width: '15%',
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
          <Typography variant = {'h5'} color = {'black'}>+</Typography>
        </Button>
        {/* title */}
        <Typography variant={'h6'} color = {'#black'} textAlign = {'center'}>
        myPantry
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
            component: 'div',
            sx: {
              backgroundColor: 'white', // Backdrop color
              color: 'black', // Text color
            }
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              // label="S"
              variant="outlined"
              onFocus={() => setIsFocused(true)} // Set isFocused to true on focus
              onBlur={() => setIsFocused(false)} // Set isFocused to false on blur
              sx={{ 
                position: 'absolute', 
                right: "2%",
                // top: '50%', 
                transform: 'translateY(-50%)',
                width: isFocused ? '35%' : `${Math.max(searchTerm.length, 0) + 5}ch`, // Dynamically adjust width based on input length
                // maxWidth: "35%",
                // height: "50px",
                transition: 'width 0.3s', // Smooth transition for width change
                
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
                style: { color: 'black', width: '100%', textAlign: 'center', right: '1%'},
              }}
            />
          )}
        />
      </Box>

      <Divider></Divider>
      
      <Image 
        src="/banner.png" // Fallback image if no image is provided
        alt="banner"
        layout="responsive"
        width={800} // Set width as needed
        height={200} // Set height as needed, maintaining aspect ratio
      />

      {/* recipes */}
      <Stack flexDirection={'row'} alignItems={'center'} justifyContent={'space-between'} padding = {2}>
      <Typography variant={'h4'} color = {'#3C3C3C'} fontWeight={'bold'}>Recipes</Typography>
      
      </Stack>
      <Divider></Divider>
      <Stack paddingX = {2} flexDirection= {'row'} alignItems = {'flex-start'} style={{overflow: 'scroll' }}>
        {recipes.map(({ recipe, ingredients, instructions }, index) => (
          // <Grid item xs={12} sm={6} md={4} lg={4} key={name}>
          <Button 
          key={index} 
          sx={{ color: "black", marginRight: 2, flexShrink: 0 }}
          onClick={() => handleRecipeModal(index)}
          >
            <Box
              display={'flex'}
              flexDirection={'column'}
              justifyContent={'space-between'}
              alignItems={'center'}
              bgcolor={'white'}
              padding={1}
              sx={{
                width: '275px', // Set a fixed width for each box
                // height: '375px', // Set a fixed width for each box
                borderRadius: '10px',
                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
                overflow: 'hidden', // Ensure contents are clipped to the padding box
              }}
            >
              <Stack direction={'column'} justifyContent={'space-between'} alignItems={'center'}>
                {image ? (
                  <Image 
                    src={image} // Use the image property from the pantry item
                    alt={recipe}
                    width={200} // Adjust width as needed
                    height={200} // Adjust height as needed
                    style={{ borderRadius: '10px' }} // Rounded edges
                  />
                ) : (
                  <Image 
                    src="/recipe.jpg" // Fallback image if no image is provided
                    alt={recipe}
                    width={200} // Adjust width as needed
                    height={200} // Adjust height as needed
                    style={{ borderRadius: '10px', objectFit: 'cover' }} // Rounded edges
                  />
                )}
              </Stack>
              <Stack>
                <Typography
                  variant={'h5'}
                  color={'#black'}
                  textAlign={'center'}
                  alignItems={"top"}
                  fontWeight={'550'}
                  style={{
                    flexGrow: 1, // Allow the text to take up remaining space
                    textAlign: "center",
                    overflow: 'hidden',
                    padding: 5,
                  }}
                >
                  {truncateString(recipe.charAt(0).toUpperCase() + recipe.slice(1), 50)}
                </Typography>
                {/* <Typography sx={{ mt: 2 }}>
                  <strong>Ingredients:</strong> {ingredients}
                </Typography>
                <Typography sx={{ mt: 2 }}>
                  <strong>Click for instructions</strong>
                </Typography> */}
              </Stack>
            </Box>
          </Button>
        ))}
      </Stack>

      {/* <Box height = {25}> </Box> */}

      {/* in your pantry */}
      <Typography padding = {2} variant={'h4'} color = {'#3C3C3C'} fontWeight={'bold'}>In your Pantry</Typography>
      <Divider></Divider>
      <Box height = {25}> </Box>
      <Grid container spacing={2} paddingX={1} style={{ height: '50%', overflow: 'scroll' }}>
        {filteredPantry.map(({ name, count, image }, index) => (
          // <React.Fragment key={name}>
            <Grid item xs={12} sm={4} key={index}>
              
              <Box
                width="100%"
                display={'flex'}
                flexDirection={'row'}
                justifyContent={'space-between'}
                alignItems={'center'}
                backgroundColor={'white'}
                padding={2.5}
                border={'1px solid lightgray'} // Add light gray border
                borderRadius={'10px'} // Round the edges
                // paddingY={2}
              >
                <Stack>
                  <Typography
                    variant={'h6'}
                    color={'#black'}
                    textAlign={'left'}
                    style={{
                      flexGrow: 1, // Allow the text to take up remaining space
                      whiteSpace: 'nowrap', // Prevent text from breaking into multiple lines
                    }}
                  >
                    {truncateString(name.charAt(0).toUpperCase() + name.slice(1), 16)}
                    {/* Limit to 16 characters */}
                  </Typography>
                  <Stack width="100%" direction={'row'} justifyContent={'start'} alignItems={'center'}>
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
                          textAlign: 'center', // Center align text
                          fontSize: '0.75rem', // Adjust font size
                        },
                        inputProps: {
                          style: { textAlign: 'center' }, // Ensure the text is centered
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
                      onClick={() => handleQuantityChange(name, count + 1)} // Increment quantity
                    >
                      +
                    </Button>
                  </Stack>
                </Stack>

                <Stack width="100%" direction={'column'} justifyContent={'space-between'} alignItems={'flex-end'}>
                  {image ? (
                    <Image
                      src={image} // Use the image property from the pantry item
                      alt={name}
                      width={100} // Adjust width as needed
                      height={100} // Adjust height as needed
                      style={{ borderRadius: '10px' }} // Rounded edges
                    />
                  ) : (
                    <Image
                      src="/ingredients.jpg" // Fallback image if no image is provided
                      alt={name}
                      width={100} // Adjust width as needed
                      height={100} // Adjust height as needed
                      style={{ borderRadius: '10px', objectFit: 'cover'}} // Rounded edges
                    />
                  )}
                </Stack>
              </Box>
            </Grid>
          // </React.Fragment>
        ))}
      </Grid>

      </Box>
      
   </Box>
  );
}
