/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import Account from './pages/Account';
import Admin from './pages/Admin';
import Contact from './pages/Contact';
import Debug from './pages/Debug';
import JobDetail from './pages/JobDetail';
import Jobs from './pages/Jobs';
import Landing from './pages/Landing';
import NewJob from './pages/NewJob';
import Pricing from './pages/Pricing';
import Security from './pages/Security';
import NewJobAI from './pages/NewJobAI';
import JobDetailAI from './pages/JobDetailAI';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Account": Account,
    "Admin": Admin,
    "Contact": Contact,
    "Debug": Debug,
    "JobDetail": JobDetail,
    "Jobs": Jobs,
    "Landing": Landing,
    "NewJob": NewJob,
    "Pricing": Pricing,
    "Security": Security,
    "NewJobAI": NewJobAI,
    "JobDetailAI": JobDetailAI,
}

export const pagesConfig = {
    mainPage: "Account",
    Pages: PAGES,
    Layout: __Layout,
};